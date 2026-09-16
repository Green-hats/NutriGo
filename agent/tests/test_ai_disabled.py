"""首次部署未启用 AI 时，不创建会话、不回滚记录、不读取图片。"""

from unittest.mock import AsyncMock

import httpx
import pytest
from test_auth import make_token, valid_payload


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/chat?message=hello", None),
    ("POST", "/api/sessions/12/regenerate", None),
    ("POST", "/api/identify-food", {"image_id": 12}),
])
async def test_disabled_ai_has_clear_error_without_side_effects(
    agent_app, monkeypatch, method, path, body,
):
    monkeypatch.setattr(agent_app.settings, "AI_ENABLED", False)
    create = AsyncMock()
    rollback = AsyncMock()
    monkeypatch.setattr(agent_app, "_load_or_create_conv", create)
    monkeypatch.setattr(agent_app.db, "rollback_last_exchange", rollback)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=agent_app.app), base_url="http://test",
    ) as client:
        response = await client.request(method, path, json=body, headers={
            "Authorization": f"Bearer {make_token(valid_payload())}",
        })
    assert response.status_code == 409
    assert "AI 功能尚未配置" in response.json()["detail"]
    create.assert_not_awaited()
    rollback.assert_not_awaited()
    agent_app.go_client.get_image_meta.assert_not_awaited()
    agent_app.identify.assert_not_called()


async def test_disabled_ai_does_not_disable_health_or_auth(agent_app, monkeypatch):
    monkeypatch.setattr(agent_app.settings, "AI_ENABLED", False)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=agent_app.app), base_url="http://test",
    ) as client:
        assert (await client.get("/api/health")).status_code == 200
        assert (await client.get("/api/chat?message=hello")).status_code == 401


async def test_chat_can_run_without_local_models(agent_app, monkeypatch):
    from unittest.mock import Mock

    monkeypatch.setattr(agent_app.settings, "AI_ENABLED", True)
    monkeypatch.setattr(agent_app.settings, "RAG_ENABLED", False)
    monkeypatch.setattr(agent_app.settings, "FOOD_RECOGNITION_ENABLED", False)
    monkeypatch.setattr(agent_app.db, "init_db", AsyncMock())
    monkeypatch.setattr(agent_app, "init_nutrition_db", AsyncMock())
    monkeypatch.setattr(agent_app, "seed_data", AsyncMock())
    rag = Mock()
    monkeypatch.setattr(agent_app, "init_rag", rag)
    async with agent_app.lifespan(agent_app.app):
        agent_app.require_ai_enabled()
    rag.assert_not_called()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=agent_app.app), base_url="http://test",
    ) as client:
        response = await client.post("/api/identify-food", json={"image_id": 12}, headers={
            "Authorization": f"Bearer {make_token(valid_payload())}",
        })
    assert response.status_code == 409
    assert "照片识别模型尚未准备好" in response.json()["detail"]
    agent_app.go_client.get_image_meta.assert_not_awaited()
    agent_app.identify.assert_not_called()
