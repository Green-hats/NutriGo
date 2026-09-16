"""照片识别预热必须受开关控制，失败不能宣告服务就绪。"""

from unittest.mock import AsyncMock, Mock

import pytest


@pytest.mark.parametrize("ai,recognition,preload,expected", [
    (True, True, True, True),
    (False, True, True, False),
    (True, False, True, False),
    (True, True, False, False),
])
async def test_startup_preloads_only_when_enabled(
    agent_app, monkeypatch, ai, recognition, preload, expected,
):
    monkeypatch.setattr(agent_app.settings, "AI_ENABLED", ai)
    monkeypatch.setattr(agent_app.settings, "RAG_ENABLED", False)
    monkeypatch.setattr(agent_app.settings, "FOOD_RECOGNITION_ENABLED", recognition)
    monkeypatch.setattr(agent_app.settings, "FOOD_MODEL_PRELOAD", preload)
    monkeypatch.setattr(agent_app.db, "init_db", AsyncMock())
    monkeypatch.setattr(agent_app, "init_nutrition_db", AsyncMock())
    monkeypatch.setattr(agent_app, "seed_data", AsyncMock())
    warmup = Mock()
    monkeypatch.setattr(agent_app, "warmup", warmup)
    async with agent_app.lifespan(agent_app.app):
        if expected:
            agent_app.list_names.assert_awaited_once_with(category="家常菜")
            warmup.assert_called_once_with(["米饭"])
        else:
            warmup.assert_not_called()
            agent_app.list_names.assert_not_awaited()


async def test_failed_preload_prevents_ready_service(agent_app, monkeypatch):
    monkeypatch.setattr(agent_app.settings, "AI_ENABLED", True)
    monkeypatch.setattr(agent_app.settings, "RAG_ENABLED", False)
    monkeypatch.setattr(agent_app.settings, "FOOD_RECOGNITION_ENABLED", True)
    monkeypatch.setattr(agent_app.settings, "FOOD_MODEL_PRELOAD", True)
    monkeypatch.setattr(agent_app.db, "init_db", AsyncMock())
    monkeypatch.setattr(agent_app, "init_nutrition_db", AsyncMock())
    monkeypatch.setattr(agent_app, "seed_data", AsyncMock())
    monkeypatch.setattr(agent_app, "warmup", Mock(side_effect=RuntimeError("model missing")))
    with pytest.raises(RuntimeError, match="model missing"):
        async with agent_app.lifespan(agent_app.app):
            pytest.fail("模型加载失败时不应接受请求")
