"""新旧照片接口共享准入；没有后台无界排队，线程未退出前不释放名额。"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi import HTTPException

from app.config import settings

T = TypeVar("T")
active_users: set[int] = set()
_tasks: set[asyncio.Task] = set()
_legacy_busy = False


async def run_photo_job(user_id: int, work: Callable[[], Awaitable[T]], *, legacy: bool = False) -> T:
    global _legacy_busy
    if user_id in active_users or len(active_users) >= settings.PHOTO_MAX_ACTIVE or (legacy and _legacy_busy):
        raise HTTPException(429, "照片正在分析中，请稍后重试。", headers={"Retry-After": "5"})
    active_users.add(user_id)
    if legacy:
        _legacy_busy = True

    async def run() -> T:
        global _legacy_busy
        try:
            return await work()
        finally:
            active_users.discard(user_id)
            if legacy:
                _legacy_busy = False

    task = asyncio.create_task(run())
    _tasks.add(task)

    def complete(finished: asyncio.Task) -> None:
        _tasks.discard(finished)
        if not finished.cancelled():
            finished.exception()  # 超时/断开的调用方离开后仍须取走异常。

    task.add_done_callback(complete)
    try:
        # asyncio 不能终止正在运行的 CPU 线程。响应可超时，名额由实际任务结束后释放。
        return await asyncio.wait_for(asyncio.shield(task), settings.PHOTO_REQUEST_TIMEOUT)
    except TimeoutError as exc:
        raise HTTPException(504, "照片分析超时，请稍后重试或手动记录。") from exc
