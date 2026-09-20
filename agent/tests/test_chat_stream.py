"""聊天流等待、终止与断线回收；不调用真实模型。"""

import asyncio
from collections import defaultdict
from unittest.mock import AsyncMock

import httpx
import pytest
from starlette.requests import ClientDisconnect, Request
from test_auth import make_token, valid_payload

from app import rate_limit
from app.chat_io import SSEChatIO
from app.chat_stream import ChatStreamingResponse
from app.conversation import Conversation


async def collect(response):
    async with asyncio.timeout(1):
        return "".join([event async for event in response.body_iterator])


async def test_idle_stream_keeps_one_blocked_reader_and_preserves_events(monkeypatch):
    io = SSEChatIO()
    read = AsyncMock(wraps=io.next_event)
    monkeypatch.setattr(io, "next_event", read)
    finish = asyncio.Event()
    release = AsyncMock()

    async def run():
        await finish.wait()
        await io.emit_chunk("第一段")
        await io.emit_chunk("第二段")
        await io.emit_done()

    response = ChatStreamingResponse(12, io, run, release, timeout=1, heartbeat_interval=0.01)
    async with asyncio.timeout(1):
        stream = response.body_iterator
        assert await anext(stream) == "event: session_id\ndata: 12\n\n"
        for _ in range(3):
            assert await anext(stream) == ": keep-alive\n\n"
        # 模型空闲期间只读过会话 ID、等待下一条消息，心跳不取消或重建读取。
        assert read.await_count == 2
        finish.set()
        assert [event async for event in stream] == [
            "event: chunk\ndata: 第一段\n\n",
            "event: chunk\ndata: 第二段\n\n",
            "event: done\ndata: \n\n",
        ]
    await response.aclose()
    release.assert_awaited_once()


@pytest.mark.parametrize("outcome", ["done", "error", "raise", "return", "timeout"])
async def test_all_producer_outcomes_end_stream_and_release_slot(outcome, caplog):
    io = SSEChatIO()
    release = AsyncMock()
    stopped = asyncio.Event()

    async def run():
        try:
            await io.emit_chunk("部分回复")
            if outcome == "done":
                await io.emit_done()
            elif outcome == "error":
                await io.emit_error("模型暂不可用")
            elif outcome == "raise":
                raise RuntimeError("private upstream request content")
            elif outcome == "timeout":
                await asyncio.Event().wait()
        finally:
            stopped.set()

    response = ChatStreamingResponse(12, io, run, release, timeout=0.02)
    body = await collect(response)
    assert "event: chunk\ndata: 部分回复" in body
    if outcome == "done":
        assert body.count("event: done") == 1
        assert "event: error" not in body
    else:
        assert body.count("event: error") == 1
        assert "event: done" not in body
        messages = {
            "error": "模型暂不可用", "raise": "回复生成失败", "return": "回复未完整生成",
            "timeout": "回复生成超时",
        }
        assert messages[outcome] in body
    assert "private upstream request content" not in body + caplog.text
    assert stopped.is_set()
    assert io.closed
    release.assert_awaited_once()


async def test_terminal_event_closes_io_once_and_rejects_late_writes():
    io = SSEChatIO()
    await io.emit_done()
    await io.emit_error("late error")
    await io.emit_chunk("late chunk")
    await io.close()
    assert await io.next_event() == "event: done\ndata: \n\n"
    assert await io.next_event() is None
    assert io._queue.empty()


@pytest.mark.parametrize("failure", ["disconnect", "body_send", "header_send", "cancel"])
async def test_asgi_exit_cancels_model_and_awaits_release(failure):
    io = SSEChatIO()
    first_body = asyncio.Event()
    stopped = asyncio.Event()
    released = asyncio.Event()
    receive_calls = 0

    async def run():
        try:
            await asyncio.Event().wait()
        finally:
            # 模拟取消模型后仍需异步关闭上游连接。
            await asyncio.sleep(0.01)
            stopped.set()

    async def release():
        await asyncio.sleep(0.01)
        released.set()

    release_spy = AsyncMock(side_effect=release)
    response = ChatStreamingResponse(12, io, run, release_spy, timeout=1, heartbeat_interval=0.01)

    async def receive():
        nonlocal receive_calls
        receive_calls += 1
        await first_body.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if failure == "header_send":
            raise OSError("connection closed before headers")
        if message["type"] == "http.response.body":
            first_body.set()
            if failure == "body_send" and message["body"].startswith(b": keep-alive"):
                raise OSError("connection closed during idle heartbeat")

    scope = {"type": "http", "asgi": {"spec_version": "2.3" if failure == "disconnect" else "2.4"}}
    async with asyncio.timeout(1):
        if failure == "cancel":
            task = asyncio.create_task(response(scope, receive, send))
            await first_body.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        elif failure in {"body_send", "header_send"}:
            with pytest.raises(ClientDisconnect):
                await response(scope, receive, send)
        else:
            await response(scope, receive, send)
    assert released.is_set()
    assert io.cancelled
    assert stopped.is_set() == (failure != "header_send")
    assert receive_calls == (1 if failure == "disconnect" else 0)
    await response.aclose()
    release_spy.assert_awaited_once()


@pytest.mark.parametrize("regenerate", [False, True])
async def test_routes_recover_after_disconnect_and_model_error(agent_app, monkeypatch, regenerate):
    main = agent_app
    monkeypatch.setattr(main.settings, "AI_ENABLED", True)
    monkeypatch.setattr(rate_limit, "_user_active", defaultdict(int))
    conv = Conversation(session_id=12, user_id=7)
    monkeypatch.setattr(main, "_load_or_create_conv", AsyncMock(return_value=conv))
    monkeypatch.setattr(main.db, "rollback_last_exchange", AsyncMock(return_value=1))
    monkeypatch.setattr(main.Conversation, "load", AsyncMock(return_value=conv))
    # 若恢复成 Request.is_disconnected() 轮询，直接报错；框架使用阻塞 receive。
    poll = AsyncMock(side_effect=AssertionError("must not poll disconnect"))
    monkeypatch.setattr(Request, "is_disconnected", poll)
    first_body = asyncio.Event()
    model_stopped = asyncio.Event()

    async def idle_model(*args: object):
        try:
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0.01)
            model_stopped.set()

    monkeypatch.setattr(main, "run_agent_loop", idle_model)
    method = "POST" if regenerate else "GET"
    path = "/api/sessions/12/regenerate" if regenerate else "/api/chat"
    token = make_token(valid_payload())
    headers = {"Authorization": f"Bearer {token}"}
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": method, "scheme": "http", "path": path,
        "raw_path": path.encode(), "query_string": b"message=hello", "root_path": "",
        "headers": [(b"authorization", headers["Authorization"].encode())],
        "server": ("test", 80), "client": ("127.0.0.1", 1234),
    }

    async def receive():
        await first_body.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and message.get("body"):
            first_body.set()

    # 穿过真实请求日志/CORS 中间件，确认断线没有遗留每用户并发名额。
    async with asyncio.timeout(1):
        await main.app(scope, receive, send)
    assert model_stopped.is_set()
    assert 7 not in rate_limit._user_active
    poll.assert_not_awaited()

    async def fail_model(*args: object):
        raise RuntimeError("model stream interrupted")

    monkeypatch.setattr(main, "run_agent_loop", fail_model)
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with asyncio.timeout(1):
            result = await client.request(method, path, params={"message": "hello"}, headers=headers)
    assert result.status_code == 200
    assert "event: error" in result.text
    assert 7 not in rate_limit._user_active
