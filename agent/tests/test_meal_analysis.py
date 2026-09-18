import asyncio
import io
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError
from test_auth import make_token, valid_payload

from app.config import settings
from recognition import meal


def result_data():
    return {
        "items": [
            {
                "name": "米饭",
                "grams": 180,
                "grams_low": 120,
                "grams_high": 220,
                "nutrition_per_100g": {"calories": 130, "protein_g": 2.5, "fat_g": 0.3, "carbs_g": 28},
                "assumption": "按普通饭碗估算",
            }
        ],
        "note": "请核对实际份量",
    }


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def vision(monkeypatch):
    monkeypatch.setattr(settings, "FOOD_VISION_API_KEY", "test-vision-key")
    monkeypatch.setattr(settings, "AI_ENABLED", True)
    monkeypatch.setattr(settings, "FOOD_RECOGNITION_ENABLED", True)
    monkeypatch.setattr(meal, "get_by_name", AsyncMock(return_value=None))


async def test_official_vision_request_and_database_reference(monkeypatch, vision):
    captured = []

    def respond(req):
        captured.append(json.loads(req.content))
        assert str(req.url) == meal.API_URL
        assert req.headers["Authorization"] == "Bearer test-vision-key"
        return httpx.Response(
            200,
            json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(result_data())}}]},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(meal.httpx, "AsyncClient", lambda **kwargs: client)
    meal.get_by_name.return_value = {"calories": 116, "protein": 2.6, "fat": 0.3, "carbohydrate": 25.9}
    result = await meal.analyze_meal(png_bytes())
    assert result.items[0].grams == 180  # 不再使用分类默认的300g
    assert result.items[0].nutrition_source == "database"
    assert result.items[0].nutrition_per_100g.calories == 116
    payload = captured[0]
    assert payload["model"] == "deepseek-flash"
    assert payload["thinking"] == {"type": "disabled"}
    assert payload["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.parametrize(
    "content,finish,expected",
    [
        (json.dumps(result_data()), "stop", True),
        ('{"items":[],"note":"照片中没有食物"}', "stop", True),
        ('{"items":', "length", False),
        ("not json", "stop", False),
        ("{}", "stop", False),
    ],
)
async def test_validate_model_response(monkeypatch, vision, content, finish, expected):
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={
                    "choices": [{"finish_reason": finish, "message": {"content": content}}],
                },
            )
        )
    )
    monkeypatch.setattr(meal.httpx, "AsyncClient", lambda **kwargs: client)
    if expected:
        result = await meal.analyze_meal(png_bytes())
        assert all(i.nutrition_source == "model" for i in result.items)
    else:
        with pytest.raises(ValueError):
            await meal.analyze_meal(png_bytes())


@pytest.mark.parametrize(
    "change",
    [
        {"grams": -1},
        {"grams": float("nan")},
        {"grams_high": 20},
        {"name": "  "},
        {"nutrition_per_100g": {"calories": 9999, "protein_g": 0, "fat_g": 0, "carbs_g": 0}},
        {"nutrition_per_100g": {"calories": 400, "protein_g": 90, "fat_g": 90, "carbs_g": 0}},
    ],
)
def test_reject_unusable_estimates(change):
    data = result_data()
    data["items"][0].update(change)
    with pytest.raises(ValidationError):
        meal.ModelMeal.model_validate(data)


def test_does_not_forward_other_providers_key(monkeypatch):
    monkeypatch.setattr(settings, "FOOD_VISION_API_KEY", "")
    monkeypatch.setattr(settings, "LLM_MODEL", "openai/example")
    monkeypatch.setattr(settings, "LLM_API_KEY", "other-provider-key")
    assert meal.vision_key() == ""
    monkeypatch.setattr(settings, "LLM_MODEL", "deepseek/deepseek-flash")
    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://proxy.example")
    assert meal.vision_key() == ""
    monkeypatch.setattr(settings, "LLM_BASE_URL", "https://api.deepseek.com")
    assert meal.vision_key() == "other-provider-key"


@pytest.fixture
def route(agent_app, monkeypatch, vision):
    from app import meal_analysis

    monkeypatch.setattr(meal_analysis, "cache", {})
    monkeypatch.setattr(meal_analysis, "active_users", set())
    item = meal.MealItem(**result_data()["items"][0], nutrition_source="model")
    monkeypatch.setattr(
        meal_analysis,
        "analyze_meal",
        AsyncMock(return_value=meal.MealAnalysis(items=[item], note="仅供估算", model="deepseek-flash")),
    )
    return meal_analysis


async def call(app, user=7, image_id=12):
    headers = {"Authorization": f"Bearer {make_token(valid_payload(user_id=user))}"} if user else {}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app.app), base_url="http://test"
    ) as client:
        return await client.post("/api/analyze-meal", json={"image_id": image_id}, headers=headers)


async def test_cache_requires_current_ownership(agent_app, route):
    assert (await call(agent_app)).status_code == 200
    assert (await call(agent_app)).status_code == 200
    route.analyze_meal.assert_awaited_once()
    assert (await call(agent_app, user=8)).status_code == 403
    assert (await call(agent_app, user=None)).status_code == 401
    agent_app.go_client.get_image_meta.side_effect = httpx.HTTPStatusError(
        "missing", request=httpx.Request("GET", "http://backend"), response=httpx.Response(404)
    )
    assert (await call(agent_app)).status_code == 404
    route.analyze_meal.assert_awaited_once()


@pytest.mark.parametrize(
    "err,status",
    [(httpx.ReadTimeout("private upstream data"), 504), (ValueError("private model output"), 502)],
)
async def test_failed_analysis_releases_slot_and_does_not_cache(agent_app, route, err, status):
    route.analyze_meal.side_effect = err
    result = await call(agent_app)
    assert result.status_code == status
    assert "private" not in result.text
    assert not route.active_users and not route.cache


async def test_concurrent_requests_are_bounded(agent_app, route):
    started, release = asyncio.Event(), asyncio.Event()
    value = route.analyze_meal.return_value

    async def pending(_):
        started.set()
        await release.wait()
        return value

    route.analyze_meal.side_effect = pending
    first = asyncio.create_task(call(agent_app))
    await started.wait()
    assert (await call(agent_app)).status_code == 429
    release.set()
    assert (await first).status_code == 200
    assert not route.active_users
