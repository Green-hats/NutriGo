"""会话锁清理 / 用户并发限制单元测试"""

import asyncio

from app import rate_limit as rl


async def test_get_session_lock_reuses_same_lock():
    lock1 = await rl.get_session_lock(1)
    lock2 = await rl.get_session_lock(1)
    assert lock1 is lock2


async def test_prune_removes_idle_locks():
    rl._session_locks.clear()
    old = 100.0  # 很旧的时间戳（monotonic），必定超过 30 分钟空闲
    fresh = 1e9  # 远在未来，不会过期
    rl._session_locks[1] = (asyncio.Lock(), old)
    rl._session_locks[2] = (asyncio.Lock(), fresh)

    removed = await rl.prune_session_locks()
    assert removed == 1
    assert 1 not in rl._session_locks
    assert 2 in rl._session_locks
    rl._session_locks.clear()


async def test_prune_noop_when_empty():
    rl._session_locks.clear()
    assert await rl.prune_session_locks() == 0


async def test_get_session_lock_refreshes_last_used():
    rl._session_locks.clear()
    await rl.get_session_lock(3)
    await rl.get_session_lock(3)
    # 存在且最近使用时间较新（不会被清理）
    assert 3 in rl._session_locks
    removed = await rl.prune_session_locks()
    assert removed == 0
    rl._session_locks.clear()


async def test_acquire_release_user(monkeypatch):
    monkeypatch.setattr(rl.settings, "MAX_ACTIVE_PER_USER", 1)
    assert await rl.acquire_user(5) is True
    assert await rl.acquire_user(5) is False  # 并发超限
    await rl.release_user(5)
    assert await rl.acquire_user(5) is True
    await rl.release_user(5)
