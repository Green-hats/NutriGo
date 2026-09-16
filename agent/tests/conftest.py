"""pytest 共享夹具 — 纯单元测试，不联网、不加载模型"""

import importlib
import sys
import types
from collections.abc import Generator
from unittest.mock import AsyncMock, Mock

import httpx
import pytest

from app.config import settings


@pytest.fixture
def db_path(tmp_path) -> Generator[str, None, None]:
    """把 agent SQLite 指向临时文件，避免污染仓库与真实数据"""
    path = str(tmp_path / "test_agent.db")
    old = settings.DATABASE_PATH
    settings.DATABASE_PATH = path
    yield path
    settings.DATABASE_PATH = old


@pytest.fixture
def fake_litellm(monkeypatch) -> Generator[types.ModuleType, None, None]:
    """伪造 litellm.utils.token_counter，避免真实导入 litellm（慢）"""
    litellm_mod = types.ModuleType("litellm")
    utils_mod = types.ModuleType("litellm.utils")

    def token_counter(model: str | None = None, text: str = "", **kwargs: object) -> int:
        # 简化计数：每 10 字符算 1 token（+1 保证非零），测试可控
        return len(text) // 10 + 1

    utils_mod.token_counter = token_counter
    litellm_mod.utils = utils_mod
    monkeypatch.setitem(sys.modules, "litellm", litellm_mod)
    monkeypatch.setitem(sys.modules, "litellm.utils", utils_mod)
    return utils_mod


@pytest.fixture
async def agent_app(monkeypatch):
    # 路由测试只替换模型和 LLM 依赖，保留真实 JWT 校验、路由和缓存逻辑。
    import app

    multimodal = types.ModuleType("recognition.multimodal")
    multimodal.warmup = Mock()
    multimodal.identify = Mock(return_value=[{"name": "米饭", "confidence": 0.9}])
    llm_client = types.ModuleType("app.llm_client")
    llm_client.run_agent_loop = AsyncMock()
    monkeypatch.setitem(sys.modules, "recognition.multimodal", multimodal)
    monkeypatch.setitem(sys.modules, "app.llm_client", llm_client)
    monkeypatch.setattr(app, "main", None, raising=False)
    main = importlib.import_module("app.main")
    from app.auth import extract_user_id

    def verify(request):
        assert request.url.path == "/api/internal/auth/verify"
        return httpx.Response(200, json={"user_id": extract_user_id(request.headers.get("Authorization"))})

    backend_client = httpx.AsyncClient(transport=httpx.MockTransport(verify))
    monkeypatch.setattr(main.go_client, "_client", backend_client)
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
        await backend_client.aclose()
