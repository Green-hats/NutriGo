"""工具注册与执行机制单元测试（不调用真实工具）"""

import asyncio

from app.config import settings
from app.tools import RegisteredTool, ToolRegistry


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
