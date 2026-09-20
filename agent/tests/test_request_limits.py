import asyncio
from unittest.mock import AsyncMock

import httpx
import pytest

from app.request_limits import RequestLimits


@pytest.mark.parametrize("declared", [None, 1, 65537])
async def test_oversized_body_rejected_before_parsing(declared):
    downstream, send = AsyncMock(), AsyncMock()
    middleware = RequestLimits(downstream)
    remaining = 1000000

    async def receive():
        nonlocal remaining
        remaining -= 8192
        return {"type": "http.request", "body": b"x" * 8192, "more_body": True}

    scope = {"type": "http", "method": "POST", "headers": []}
    if declared is not None:
        scope["headers"] = [(b"content-length", str(declared).encode())]
    await middleware(scope, receive, send)
    downstream.assert_not_awaited()
    assert send.call_args_list[0].args[0]["status"] == 413
    assert remaining >= 1000000 - 9 * 8192
    assert middleware.reading == 0


async def test_slow_body_times_out_and_frees_capacity():
    downstream, send = AsyncMock(), AsyncMock()
    middleware = RequestLimits(downstream, timeout=0.01)

    async def receive():
        await asyncio.Event().wait()

    await middleware({"type": "http", "method": "POST", "headers": []}, receive, send)
    downstream.assert_not_awaited()
    assert send.call_args_list[0].args[0]["status"] == 408
    assert middleware.reading == 0


async def test_body_preserved_and_sse_disconnect_receive_not_stolen():
    messages = [
        {"type": "http.request", "body": b"x" * 32768, "more_body": True},
        {"type": "http.request", "body": b"x" * 32768, "more_body": False},
        {"type": "http.disconnect"},
    ]
    receive, send = AsyncMock(side_effect=messages), AsyncMock()

    async def app(scope, replay, send):
        assert (await replay())["body"] == b"x" * 65536
        assert (await replay())["type"] == "http.disconnect"

    middleware = RequestLimits(app)
    await middleware({"type": "http", "method": "POST", "headers": []}, receive, send)
    downstream = AsyncMock()
    middleware.app = downstream
    receive.reset_mock()
    await middleware({"type": "http", "method": "GET", "headers": []}, receive, send)
    receive.assert_not_awaited()
    assert downstream.call_args.args[1] is receive


async def test_real_app_rejects_unauthenticated_large_json(agent_app):
    transport = httpx.ASGITransport(app=agent_app.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.patch("/api/sessions/1", json={"name": "x" * 2_097_152})
        assert response.status_code == 413
        assert (await client.patch("/api/sessions/1", json={"name": "small"})).status_code == 401
        assert (await client.get("/api/health")).status_code == 200


async def test_too_many_body_readers_rejected_without_queue():
    app, receive, send = AsyncMock(), AsyncMock(), AsyncMock()
    middleware = RequestLimits(app)
    middleware.reading = 64
    await middleware({"type": "http", "method": "POST", "headers": []}, receive, send)
    assert send.call_args_list[0].args[0]["status"] == 503
    receive.assert_not_awaited()
    app.assert_not_awaited()
