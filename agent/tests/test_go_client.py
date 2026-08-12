"""Go 后端 HTTP 客户端单元测试（MockTransport，不联网）"""

import httpx
import pytest

import recognition.go_client as gc
from app.config import settings


@pytest.fixture
def client_config(monkeypatch):
    monkeypatch.setattr(settings, "GO_BACKEND_URL", "http://test-backend")
    monkeypatch.setattr(settings, "INTERNAL_TOKEN", "test-internal-token")


def _patch_transport(monkeypatch, transport: httpx.MockTransport) -> None:
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        gc.httpx, "AsyncClient",
        lambda *args, **kwargs: real_async_client(transport=transport),
    )


async def test_get_user_profile_sends_internal_token(client_config, monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Internal-Token"] == "test-internal-token"
        assert request.url.path == "/api/internal/users/3/profile"
        return httpx.Response(200, json={"height_cm": 175, "weight_kg": 78})

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    data = await gc.GoClient().get_user_profile(3)
    assert data["height_cm"] == 175


async def test_get_diet_logs_passes_params(client_config, monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["user_id"] == "7"
        assert request.url.params["date"] == "2026-08-01"
        return httpx.Response(200, json=[{"id": 1, "food_name": "米饭"}])

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    logs = await gc.GoClient().get_diet_logs(7, "2026-08-01")
    assert logs[0]["food_name"] == "米饭"


async def test_get_image_data_returns_bytes(client_config, monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"\x89PNG fake")

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    data = await gc.GoClient().get_image_data(1)
    assert data == b"\x89PNG fake"


async def test_http_error_raises(client_config, monkeypatch):
    _patch_transport(monkeypatch, httpx.MockTransport(lambda req: httpx.Response(500)))
    with pytest.raises(httpx.HTTPStatusError):
        await gc.GoClient().get_user_profile(1)


async def test_http_error_raises_on_summaries(client_config, monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPStatusError):
        await gc.GoClient().get_diet_summaries(1, "2026-08-01", "2026-08-31")


async def test_retries_on_server_error_then_succeeds(client_config, monkeypatch):
    """502/503/504 会重试，最终成功返回"""
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(503, json={"error": "busy"})
        return httpx.Response(200, json=[{"id": 1, "food_name": "米饭"}])

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    logs = await gc.GoClient().get_diet_logs(7, "2026-08-01")
    assert calls == 3  # 2 次 503 + 1 次成功
    assert logs[0]["food_name"] == "米饭"


async def test_retries_on_connection_error(client_config, monkeypatch):
    """网络错误（TransportError）会重试，最终成功"""
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise httpx.ConnectError("连接被拒绝", request=request)
        return httpx.Response(200, json={"height_cm": 175})

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    profile = await gc.GoClient().get_user_profile(1)
    assert calls == 3
    assert profile["height_cm"] == 175


async def test_retry_exhausted_raises_last_error(client_config, monkeypatch):
    """始终 503 时，重试耗尽后抛出最后一个错误"""
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "busy"})

    _patch_transport(monkeypatch, httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPStatusError):
        await gc.GoClient().get_user_profile(1)
