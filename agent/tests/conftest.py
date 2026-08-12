"""pytest 共享夹具 — 纯单元测试，不联网、不加载模型"""

import sys
import types
from collections.abc import Generator

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
