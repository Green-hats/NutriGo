"""图片识别接口归属校验：通过 ASGI 请求测试，不加载模型、不启动服务。"""

import importlib
import sys
import types
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from test_auth import make_token, valid_payload


@pytest.fixture
def agent_app(monkeypatch):
    # 路由测试只替换模型和 LLM 依赖，保留真实 JWT 校验、路由和缓存逻辑。
    import app

    multimodal = types.ModuleType("recognition.multimodal")
    multimodal.identify = Mock(return_value=[{"name": "米饭", "confidence": 0.9}])
    llm_client = types.ModuleType("app.llm_client")
    llm_client.run_agent_loop = AsyncMock()
    monkeypatch.setitem(sys.modules, "recognition.multimodal", multimodal)
    monkeypatch.setitem(sys.modules, "app.llm_client", llm_client)
    monkeypatch.setattr(app, "main", None, raising=False)
    main = importlib.import_module("app.main")
    monkeypatch.setattr(main, "_identify_cache", {})
    monkeypatch.setattr(main.go_client, "get_image_meta", AsyncMock(return_value={"id": 12, "user_id": 7}))
    monkeypatch.setattr(main.go_client, "get_image_data", AsyncMock(return_value=b"image bytes"))
    monkeypatch.setattr(main, "list_names", AsyncMock(return_value=["米饭"]))
    monkeypatch.setattr(main, "get_by_name", AsyncMock(return_value={"calories": 116}))
    monkeypatch.setattr(main, "get_portion", AsyncMock(return_value={"grams": 200}))
    try:
        yield main
    finally:
        # 不让带模型替身的应用模块泄漏到其他测试。
        sys.modules.pop("app.main", None)


async def identify_request(main, user_id=7):
    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {make_token(valid_payload(user_id=user_id))}"
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.post("/api/identify-food", json={"image_id": 12}, headers=headers)


async def test_owner_can_identify_and_reuse_cache(agent_app):
    first = await identify_request(agent_app)
    second = await identify_request(agent_app)

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert first.json()[0]["name"] == "米饭"
    assert first.json()[0]["nutrition_per_100g"]["calories"] == 116
    assert agent_app.go_client.get_image_meta.await_count == 2
    agent_app.go_client.get_image_data.assert_awaited_once_with(12)
    agent_app.identify.assert_called_once_with(b"image bytes", ["米饭"], 5)


@pytest.mark.parametrize("cached", [False, True])
async def test_other_user_cannot_identify_even_when_cached(agent_app, cached):
    if cached:
        agent_app._cache_set(12, [{"name": "private cached result"}])

    response = await identify_request(agent_app, user_id=8)

    assert response.status_code == 403
    assert "private cached result" not in response.text
    agent_app.go_client.get_image_data.assert_not_awaited()
    agent_app.identify.assert_not_called()


async def test_unauthenticated_request_rejected_before_lookup(agent_app):
    response = await identify_request(agent_app, user_id=None)
    assert response.status_code == 401
    agent_app.go_client.get_image_meta.assert_not_awaited()
    agent_app.go_client.get_image_data.assert_not_awaited()


@pytest.mark.parametrize("backend_status, expected", [(404, 404), (403, 502), (503, 502)])
async def test_metadata_failure_never_serves_cached_result(agent_app, backend_status, expected):
    agent_app._cache_set(12, [{"name": "private cached result"}])
    request = httpx.Request("GET", "http://backend/api/images/12")
    agent_app.go_client.get_image_meta.side_effect = httpx.HTTPStatusError(
        "metadata error", request=request, response=httpx.Response(backend_status, request=request),
    )

    response = await identify_request(agent_app)

    assert response.status_code == expected
    assert "private cached result" not in response.text
    agent_app.go_client.get_image_data.assert_not_awaited()
    agent_app.identify.assert_not_called()


async def test_metadata_timeout_never_serves_cached_result(agent_app):
    agent_app._cache_set(12, [{"name": "private cached result"}])
    agent_app.go_client.get_image_meta.side_effect = httpx.ReadTimeout("timeout")

    response = await identify_request(agent_app)

    assert response.status_code == 502
    agent_app.go_client.get_image_data.assert_not_awaited()
    agent_app.identify.assert_not_called()


async def test_metadata_without_owner_is_rejected(agent_app):
    agent_app.go_client.get_image_meta.return_value = {"id": 12}
    response = await identify_request(agent_app)
    assert response.status_code == 403
    agent_app.go_client.get_image_data.assert_not_awaited()
