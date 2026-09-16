"""Agent 的所有鉴权路由必须检查 Go 的实时吊销状态，包括缓存命中。"""

from unittest.mock import AsyncMock

import httpx
import pytest
from test_auth import make_token, valid_payload

PROTECTED_ROUTES = [
    ("GET", "/api/chat?message=hello", None),
    ("POST", "/api/sessions/12/regenerate", None),
    ("GET", "/api/sessions", None),
    ("GET", "/api/sessions/12", None),
    ("DELETE", "/api/sessions/12", None),
    ("POST", "/api/sessions/batch-delete", {"ids": [12]}),
    ("PATCH", "/api/sessions/12", {"name": "private"}),
    ("POST", "/api/identify-food", {"image_id": 12}),
    ("POST", "/api/calculate-intake", {"food_name": "米饭", "grams": 200}),
]


@pytest.mark.parametrize("method,path,body", PROTECTED_ROUTES)
@pytest.mark.parametrize("backend_status,expected", [(401, 401), (503, 503), (403, 503)])
async def test_revoked_or_unverifiable_tokens_cannot_access_routes(
    agent_app, monkeypatch, method, path, body, backend_status, expected,
):
    calls = []

    def verify(request):
        calls.append(request)
        assert request.url.path == "/api/internal/auth/verify"
        assert request.headers["X-Internal-Token"] == agent_app.go_client.headers["X-Internal-Token"]
        assert request.headers["Authorization"].startswith("Bearer ")
        return httpx.Response(backend_status, json={"message": "denied"})

    agent_app._cache_set(12, [{"name": "private cached result"}])
    async with httpx.AsyncClient(transport=httpx.MockTransport(verify)) as backend:
        monkeypatch.setattr(agent_app.go_client, "_client", backend)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=agent_app.app), base_url="http://test",
        ) as client:
            response = await client.request(method, path, json=body, headers={
                "Authorization": f"Bearer {make_token(valid_payload())}",
            })
    assert response.status_code == expected
    assert len(calls) == 1
    assert "private cached result" not in response.text
    agent_app.go_client.get_image_meta.assert_not_awaited()
    agent_app.go_client.get_image_data.assert_not_awaited()
    agent_app.identify.assert_not_called()
    agent_app.run_agent_loop.assert_not_awaited()


async def test_cached_image_checks_revocation_on_every_request(agent_app, monkeypatch):
    from test_identify_auth import identify_request

    calls = 0

    def verify(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"user_id": 7}) if calls == 1 else httpx.Response(401)

    async with httpx.AsyncClient(transport=httpx.MockTransport(verify)) as backend:
        monkeypatch.setattr(agent_app.go_client, "_client", backend)
        assert (await identify_request(agent_app)).status_code == 200
        assert (await identify_request(agent_app)).status_code == 401
    assert calls == 2
    agent_app.identify.assert_called_once()


async def test_verification_timeout_fails_closed(agent_app, monkeypatch):
    from test_identify_auth import identify_request

    def verify(request):
        raise httpx.ReadTimeout("timeout", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(verify)) as backend:
        monkeypatch.setattr(agent_app.go_client, "_client", backend)
        response = await identify_request(agent_app)
    assert response.status_code == 503
    agent_app.go_client.get_image_data.assert_not_awaited()


async def test_verification_identity_mismatch_fails_closed(agent_app, monkeypatch):
    from test_identify_auth import identify_request

    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"user_id": 8}))
    async with httpx.AsyncClient(transport=transport) as backend:
        monkeypatch.setattr(agent_app.go_client, "_client", backend)
        response = await identify_request(agent_app)
    assert response.status_code == 503
    agent_app.go_client.get_image_data.assert_not_awaited()


async def test_health_probes_do_not_require_auth_service(agent_app, monkeypatch):
    verify = AsyncMock(side_effect=AssertionError("health must not verify JWT"))
    monkeypatch.setattr(agent_app.go_client, "verify_access_token", verify)
    monkeypatch.setattr(agent_app.db, "ping", AsyncMock())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=agent_app.app), base_url="http://test",
    ) as client:
        assert (await client.get("/api/health")).status_code == 200
        assert (await client.get("/api/ready")).status_code == 200
    verify.assert_not_awaited()
