"""
并发保护 / 限流

两级保护：
  A. 会话级锁：同一会话的对话串行处理，避免并发写入互相覆盖
  B. 用户级并发限制：同一用户同时最多 N 个活跃对话（默认 1）
"""

import asyncio
import time
from collections import defaultdict

from app.config import settings

# 会话级锁：session_id -> (asyncio.Lock, 最近使用时间)
# 只增不减会随会话数量膨胀，因此记录 last_used 供空闲清理
_session_locks: dict[int, tuple[asyncio.Lock, float]] = {}
_session_locks_guard = asyncio.Lock()

# 会话锁空闲清理阈值：超过该数量时惰性清理，另可被后台任务周期调用
_SESSION_LOCK_PRUNE_THRESHOLD = 1000
_SESSION_LOCK_MAX_IDLE = 30 * 60  # 30 分钟无使用视为空闲

# 用户级活跃计数：user_id -> 当前活跃对话数
_user_active: dict[int, int] = defaultdict(int)
_user_active_guard = asyncio.Lock()


async def get_session_lock(session_id: int) -> asyncio.Lock:
    """获取（必要时创建）某个会话的锁，并刷新最近使用时间"""
    now = time.monotonic()
    async with _session_locks_guard:
        if len(_session_locks) > _SESSION_LOCK_PRUNE_THRESHOLD:
            _prune_session_locks_locked(now)
        entry = _session_locks.get(session_id)
        if entry is None:
            lock = asyncio.Lock()
            _session_locks[session_id] = (lock, now)
            return lock
        _session_locks[session_id] = (entry[0], now)
        return entry[0]


def _prune_session_locks_locked(now: float) -> None:
    expired = [
        sid for sid, (_, last) in _session_locks.items()
        if now - last > _SESSION_LOCK_MAX_IDLE
    ]
    for sid in expired:
        del _session_locks[sid]


async def prune_session_locks() -> int:
    """清理空闲会话锁，返回清理条数。可被后台任务周期调用。"""
    async with _session_locks_guard:
        before = len(_session_locks)
        _prune_session_locks_locked(time.monotonic())
        return before - len(_session_locks)


async def acquire_user(user_id: int) -> bool:
    """尝试占用一个用户并发名额，成功返回 True，超限返回 False"""
    async with _user_active_guard:
        if _user_active[user_id] >= settings.MAX_ACTIVE_PER_USER:
            return False
        _user_active[user_id] += 1
        return True


async def release_user(user_id: int) -> None:
    """释放一个用户并发名额"""
    async with _user_active_guard:
        if _user_active.get(user_id, 0) > 0:
            _user_active[user_id] -= 1
            if _user_active[user_id] == 0:
                _user_active.pop(user_id, None)
