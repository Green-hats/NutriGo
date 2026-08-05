"""
并发保护 / 限流

两级保护：
  A. 会话级锁：同一会话的对话串行处理，避免并发写入互相覆盖
  B. 用户级并发限制：同一用户同时最多 N 个活跃对话（默认 1）
"""

import asyncio
from collections import defaultdict
from typing import Optional

from app.config import settings

# 会话级锁：session_id -> asyncio.Lock
_session_locks: dict[int, asyncio.Lock] = {}
_session_locks_guard = asyncio.Lock()

# 用户级活跃计数：user_id -> 当前活跃对话数
_user_active: dict[int, int] = defaultdict(int)
_user_active_guard = asyncio.Lock()


async def get_session_lock(session_id: int) -> asyncio.Lock:
    """获取（必要时创建）某个会话的锁"""
    async with _session_locks_guard:
        if session_id not in _session_locks:
            _session_locks[session_id] = asyncio.Lock()
        return _session_locks[session_id]


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
