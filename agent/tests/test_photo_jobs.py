import asyncio
import threading

import httpx
import pytest
from fastapi import HTTPException
from test_identify_auth import identify_request

from app import photo_jobs
from app.config import settings


@pytest.fixture(autouse=True)
def slots(monkeypatch):
    monkeypatch.setattr(photo_jobs, "active_users", set())
    monkeypatch.setattr(photo_jobs, "_legacy_busy", False)
    monkeypatch.setattr(settings, "PHOTO_MAX_ACTIVE", 4)


async def test_new_and_legacy_share_user_and_global_limits():
    entered, finish = asyncio.Queue(), asyncio.Event()

    async def work():
        await entered.put(True)
        await finish.wait()
        return "ok"

    pending = []
    try:
        for user in range(1, 5):
            pending.append(asyncio.create_task(photo_jobs.run_photo_job(user, work, legacy=user == 1)))
            await entered.get()
        for user, legacy in [(1, False), (5, False), (5, True)]:
            with pytest.raises(HTTPException) as error:
                await photo_jobs.run_photo_job(user, work, legacy=legacy)
            assert error.value.status_code == 429
    finally:
        finish.set()
        assert await asyncio.gather(*pending) == ["ok"] * 4
    assert not photo_jobs.active_users


@pytest.mark.parametrize("exit_mode", ["timeout", "cancel"])
async def test_timed_out_or_cancelled_request_keeps_thread_slot(monkeypatch, exit_mode):
    monkeypatch.setattr(settings, "PHOTO_REQUEST_TIMEOUT", 0.03 if exit_mode == "timeout" else 2)
    started, finish = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()

    def model():
        loop.call_soon_threadsafe(started.set)
        assert finish.wait(2)
        return "done"

    async def work():
        return await asyncio.to_thread(model)

    pending = asyncio.create_task(photo_jobs.run_photo_job(1, work, legacy=True))
    try:
        await asyncio.wait_for(started.wait(), 1)
        if exit_mode == "cancel":
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
        else:
            with pytest.raises(HTTPException) as error:
                await pending
            assert error.value.status_code == 504
        assert 1 in photo_jobs.active_users
        with pytest.raises(HTTPException) as error:
            await photo_jobs.run_photo_job(2, work, legacy=True)
        assert error.value.status_code == 429
    finally:
        finish.set()
        await asyncio.gather(*photo_jobs._tasks, return_exceptions=True)
    assert not photo_jobs.active_users
    assert await photo_jobs.run_photo_job(2, work, legacy=True) == "done"


async def test_identify_burst_does_not_download_or_queue_extra_images(agent_app, monkeypatch):
    started, finish = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    model = agent_app.identify

    def blocked(*args: object):
        loop.call_soon_threadsafe(started.set)
        assert finish.wait(3)
        return [{"name": "米饭", "confidence": 0.9}]

    model.side_effect = blocked
    first = asyncio.create_task(identify_request(agent_app))
    try:
        await asyncio.wait_for(started.wait(), 1)
        responses = await asyncio.gather(*(identify_request(agent_app) for _ in range(9)))
        assert [r.status_code for r in responses] == [429] * 9
        model.assert_called_once()
        agent_app.go_client.get_image_data.assert_awaited_once()
        transport = httpx.ASGITransport(app=agent_app.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            assert (await c.get("/api/health")).status_code == 200
    finally:
        finish.set()
        assert (await first).status_code == 200
    assert (await identify_request(agent_app)).status_code == 200
    model.assert_called_once()  # 后续重复请求复用缓存。
