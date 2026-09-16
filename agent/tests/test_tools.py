"""工具注册与执行机制单元测试（不调用真实工具）"""

import asyncio
from unittest.mock import Mock

import pytest

from app.config import settings
from app.tools import RegisteredTool, ToolRegistry, registry


def add(a: int, b: int) -> str:
    return str(a + b)


async def greet(name: str, prefix: str = "") -> str:
    return f"{prefix}{name}"


def boom() -> str:
    raise ValueError("boom")


async def slow_tool() -> str:
    await asyncio.sleep(10)
    return "done"


# ---------------- schema 推断 ----------------

def test_schema_infers_types_and_required():
    tool = RegisteredTool(add, "add", "add two numbers")
    schema = tool.parameters
    assert schema["type"] == "object"
    assert schema["properties"]["a"]["type"] == "integer"
    assert schema["properties"]["b"]["type"] == "integer"
    assert schema["required"] == ["a", "b"]


def test_schema_optional_param_not_required():
    tool = RegisteredTool(greet, "greet", "greet someone")
    assert tool.parameters["required"] == ["name"]
    assert "prefix" not in tool.parameters["required"]


# ---------------- 同步执行 ----------------

def test_execute_success():
    tool = RegisteredTool(add, "add", "d")
    assert tool.execute('{"a":1,"b":2}') == "3"


def test_execute_invalid_json():
    tool = RegisteredTool(add, "add", "d")
    assert "参数解析失败" in tool.execute("not-json")


def test_execute_missing_required_param():
    tool = RegisteredTool(add, "add", "d")
    assert "缺少必要参数" in tool.execute('{"a":1}')


def test_execute_error_caught():
    tool = RegisteredTool(boom, "boom", "d")
    assert "工具执行出错" in tool.execute("{}")


# ---------------- 异步执行 ----------------

async def test_execute_async_success():
    tool = RegisteredTool(greet, "greet", "d")
    result = await tool.execute_async('{"name":"alice","prefix":"Hi "}')
    assert result == "Hi alice"


async def test_execute_async_injects_defaults():
    tool = RegisteredTool(greet, "greet", "d")
    result = await tool.execute_async('{"name":"alice"}', defaults={"prefix": "Hi ", "extra": 1})
    assert result == "Hi alice"


async def test_execute_async_defaults_not_overriding():
    tool = RegisteredTool(greet, "greet", "d")
    result = await tool.execute_async('{"name":"alice","prefix":"LLM "}', defaults={"prefix": "Injected "})
    assert result == "LLM alice"


@pytest.mark.parametrize("name", ["get_user_profile", "get_diet_history", "get_diet_summary"])
def test_personal_tool_schema_hides_user_id(name):
    tool = registry.get(name)
    assert tool is not None
    schema = tool.to_openai()["function"]["parameters"]
    assert "user_id" not in schema["properties"]
    assert "user_id" not in schema["required"]


@pytest.mark.parametrize("arguments", ['{}', '{"user_id":999}', '{"user_id":null}'])
async def test_personal_tool_binds_authenticated_user(arguments):
    def personal_lookup(user_id: int) -> str:
        return str(user_id)

    tool = RegisteredTool(personal_lookup, "personal_lookup", "d")
    assert await tool.execute_async(arguments, user_id=7) == "7"
    assert tool.execute(arguments, user_id=7) == "7"


@pytest.mark.parametrize("user_id", [None, 0, -1, True])
async def test_personal_tool_requires_trusted_identity(user_id):
    called = Mock()

    def personal_lookup(user_id: int) -> str:
        called(user_id)
        return "private data"

    tool = RegisteredTool(personal_lookup, "personal_lookup", "d")
    # 模型参数和普通 defaults 均不能充当认证身份。
    result = await tool.execute_async('{"user_id":999}', defaults={"user_id":7}, user_id=user_id)
    assert "拒绝执行" in result
    assert "拒绝执行" in tool.execute('{"user_id":999}', user_id=user_id)
    called.assert_not_called()


async def test_non_personal_tool_ignores_model_user_id():
    tool = RegisteredTool(greet, "greet", "d")
    assert await tool.execute_async('{"name":"alice","user_id":999}', user_id=7) == "alice"


async def test_execute_async_error_caught():
    tool = RegisteredTool(boom, "boom", "d")
    assert "工具执行出错" in await tool.execute_async("{}")


async def test_execute_async_timeout(monkeypatch):
    monkeypatch.setattr(settings, "TOOL_TIMEOUT", 0.05)
    tool = RegisteredTool(slow_tool, "slow_tool", "d")
    result = await tool.execute_async("{}")
    assert "超时" in result


async def test_execute_async_truncates_long_result(monkeypatch):
    monkeypatch.setattr(settings, "TOOL_RESULT_MAX_CHARS", 10)
    tool = RegisteredTool(greet, "greet", "d")
    result = await tool.execute_async('{"name":"ABCDEFGHIJKLMNOP"}')
    assert "结果过长" in result


# ---------------- 注册表 ----------------

def test_registry_register_get_format():
    reg = ToolRegistry()
    tool = reg.register(add, name="add", description="sum")
    assert reg.get("add") is tool
    assert reg.get("missing") is None

    formatted = reg.to_openai_format()
    assert formatted[0]["type"] == "function"
    assert formatted[0]["function"]["name"] == "add"
    assert formatted[0]["function"]["description"] == "sum"
