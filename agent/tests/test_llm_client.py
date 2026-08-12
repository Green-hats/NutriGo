"""Agent Loop 单元测试（mock litellm，不联网）

在 import app.llm_client 之前，把 sys.modules['litellm'] 替换为假模块，
避免真实导入 litellm（慢），且便于逐测试控制 acompletion 行为。
"""

import asyncio
import sys
import types
from types import SimpleNamespace

import pytest

# ---- 假 litellm（必须在 import app.llm_client 之前生效）----
_litellm_fake = types.ModuleType("litellm")
_litellm_fake.drop_params = True
_litellm_fake.acompletion = None  # 占位，供 monkeypatch.setattr 覆盖
sys.modules["litellm"] = _litellm_fake

from app.chat_io import ChatIO  # noqa: E402
from app.conversation import Conversation  # noqa: E402
from app.llm_client import _build_kwargs, run_agent_loop  # noqa: E402
from app.tools import ToolRegistry  # noqa: E402

# ---------------- 测试辅助 ----------------

class RecordingChatIO(ChatIO):
    """记录所有 emit 事件的假 ChatIO"""

    def __init__(self, cancelled: bool = False) -> None:
        self.events: list[tuple[str, str]] = []
        self._cancelled = cancelled

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def cancel(self) -> None:
        self._cancelled = True

    def _record(self, event: str, data: str = "") -> None:
        self.events.append((event, data))

    async def emit_chunk(self, text: str) -> None:
        self._record("chunk", text)

    async def emit_thinking(self, message: str = "") -> None:
        self._record("thinking", message)

    async def emit_tool_call(self, tool_name: str, arguments: str) -> None:
        self._record("tool_call", tool_name)

    async def emit_tool_result(self, tool_name: str, result: str) -> None:
        self._record("tool_result", result)

    async def emit_done(self) -> None:
        self._record("done", "")

    async def emit_error(self, error: str) -> None:
        self._record("error", error)

    def has(self, event: str) -> bool:
        return any(e == event for e, _ in self.events)


def make_delta(
    content: str | None = None,
    reasoning: str | None = None,
    tool_calls: list | None = None,
) -> object:
    return SimpleNamespace(content=content, reasoning_content=reasoning, tool_calls=tool_calls)


def make_chunk(
    content: str | None = None,
    reasoning: str | None = None,
    tool_calls: list | None = None,
) -> object:
    return SimpleNamespace(choices=[SimpleNamespace(delta=make_delta(content, reasoning, tool_calls))])


def make_tool_call(index: int, id: str, name: str = "", arguments: str = "") -> object:
    return SimpleNamespace(index=index, id=id, function=SimpleNamespace(name=name, arguments=arguments))


def stream(*chunks: object):
    """返回一个 async generator，逐 chunk yield"""
    async def _gen():
        for c in chunks:
            yield c
    return _gen()


def set_acompletion(monkeypatch, handler) -> None:
    """handler(chunks_builder, kwargs) 返回 coroutine，供 litellm.acompletion 使用"""
    monkeypatch.setattr(_litellm_fake, "acompletion", handler)


def make_conv() -> Conversation:
    return Conversation()  # session_id=0，save() 直接跳过，无需数据库


@pytest.fixture
def registry() -> ToolRegistry:
    reg = ToolRegistry()

    @reg.tool(name="fake_lookup", description="查询营养")
    async def fake_lookup(food_name: str) -> str:
        return f"nutrition:{food_name}"

    return reg


# ---------------- 测试用例 ----------------

async def test_final_answer_streams_chunks(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        return stream(
            make_chunk(content="苹果"),
            make_chunk(content="营养"),
        )

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    chunks = [d for e, d in chat_io.events if e == "chunk"]
    assert chunks == ["苹果", "营养"]
    assert chat_io.has("done")
    assert conv.messages[-1]["role"] == "assistant"
    assert conv.messages[-1]["content"] == "苹果营养"


async def test_thinking_forwarded_and_stored(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        return stream(
            make_chunk(reasoning="先查数据"),
            make_chunk(content="答案"),
        )

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert chat_io.has("thinking")
    assert conv.messages[-1]["thinking"] == "先查数据"
    assert conv.messages[-1]["content"] == "答案"


async def test_tool_call_then_final_answer(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()
    calls: list[dict] = []

    async def handler(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            # 第一轮：决定调用工具
            return stream(make_chunk(tool_calls=[
                make_tool_call(0, "call_1", "fake_lookup", '{"food_name":"苹果"}'),
            ]))
        # 第二轮：最终回答
        return stream(make_chunk(content="根据数据回答"))

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    # 工具被调用并广播
    assert any(e == "tool_call" for e, _ in chat_io.events)
    assert any(e == "tool_result" for e, _ in chat_io.events)
    assert ("tool_result", "nutrition:苹果") in chat_io.events
    # 对话中出现了 tool 消息
    assert any(m["role"] == "tool" for m in conv.messages)
    # 最终答案
    assert conv.messages[-1]["content"] == "根据数据回答"
    assert chat_io.has("done")


async def test_tool_call_crosses_chunks(monkeypatch, registry):
    """工具调用参数跨多个 chunk 累积"""
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        return stream(
            make_chunk(tool_calls=[make_tool_call(0, "call_1", "fake_", '{"foo')]),
            make_chunk(tool_calls=[make_tool_call(0, "", "lookup", 'd_name":"苹果"}')]),
        )

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert ("tool_result", "nutrition:苹果") in chat_io.events


async def test_unknown_tool_reports_error(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        return stream(make_chunk(tool_calls=[make_tool_call(0, "c", "no_such_tool", "{}")]))

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert ("tool_result", "未知工具: no_such_tool") in chat_io.events


async def test_retry_after_transient_failure(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()
    attempts = 0

    async def handler(**kwargs):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("网络抖动")
        return stream(make_chunk(content="恢复成功"))

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert attempts == 3
    assert chat_io.has("done")
    assert conv.messages[-1]["content"] == "恢复成功"


async def test_all_attempts_fail_emits_error(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        raise RuntimeError("总是失败")

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert ("error", "LLM 调用多次失败，请稍后重试") in chat_io.events
    assert not chat_io.has("done")


async def test_timeout_emits_error(monkeypatch, registry):
    monkeypatch.setattr("app.llm_client.settings.LLM_TIMEOUT", 0.05)
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        await asyncio.sleep(10)
        return stream(make_chunk(content="x"))

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert chat_io.has("error")


async def test_cancelled_at_start_exits_immediately(monkeypatch, registry):
    chat_io = RecordingChatIO(cancelled=True)
    conv = make_conv()
    called = False

    async def handler(**kwargs):
        nonlocal called
        called = True
        return stream(make_chunk(content="不应出现"))

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert chat_io.events == []
    assert not called


async def test_cancelled_during_stream_stops(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        async def _gen():
            yield make_chunk(content="部分")
            chat_io.cancel()
            yield make_chunk(content="后段")
        return _gen()

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    # 取消后停止接收后续 chunk；已收到的部分内容仍作为回答输出
    chunks = [d for e, d in chat_io.events if e == "chunk"]
    assert "部分" in chunks
    assert "后段" not in chunks
    assert chat_io.has("done")


async def test_empty_response_emits_error(monkeypatch, registry):
    chat_io = RecordingChatIO()
    conv = make_conv()

    async def handler(**kwargs):
        return stream()

    set_acompletion(monkeypatch, handler)
    await run_agent_loop(conv, registry, chat_io)

    assert ("error", "LLM 未返回有效内容") in chat_io.events


def test_build_kwargs_includes_key_and_tools(monkeypatch, registry):
    monkeypatch.setattr("app.llm_client.settings.LLM_MODEL", "deepseek/deepseek-chat")
    monkeypatch.setattr("app.llm_client.settings.LLM_API_KEY", "sk-test")
    monkeypatch.setattr("app.llm_client.settings.LLM_BASE_URL", "http://proxy:8000")

    tools = registry.to_openai_format()
    kwargs = _build_kwargs([{"role": "user", "content": "hi"}], tools, stream=True)
    assert kwargs["model"] == "deepseek/deepseek-chat"
    assert kwargs["api_key"] == "sk-test"
    assert kwargs["api_base"] == "http://proxy:8000"
    assert kwargs["stream"] is True
    assert kwargs["tools"] == tools


def test_build_kwargs_omits_empty_fields(monkeypatch, registry):
    monkeypatch.setattr("app.llm_client.settings.LLM_API_KEY", "")
    monkeypatch.setattr("app.llm_client.settings.LLM_BASE_URL", "")
    kwargs = _build_kwargs([], tools=None, stream=False)
    assert "api_key" not in kwargs
    assert "api_base" not in kwargs
    assert "tools" not in kwargs
