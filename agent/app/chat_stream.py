"""SSE 生命周期：阻塞等消息，框架监听断线，所有退出路径回收任务与名额。"""

import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable

import anyio
from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from app.chat_io import SSEChatIO

logger = logging.getLogger("uvicorn")


class ChatStreamingResponse(StreamingResponse):
    def __init__(
        self,
        session_id: int,
        chat_io: SSEChatIO,
        run_agent: Callable[[], Awaitable[None]],
        release: Callable[[], Awaitable[None]],
        *,
        timeout: float,
        heartbeat_interval: float = 15,
    ) -> None:
        self._session_id = session_id
        self._io = chat_io
        self._run_agent = run_agent
        self._release = release
        self._timeout = timeout
        self._heartbeat_interval = heartbeat_interval
        self._producer: asyncio.Task[None] | None = None
        self._reader: asyncio.Task[str | None] | None = None
        self._cleanup_task: asyncio.Task[None] | None = None
        self._events = self._stream_events()
        super().__init__(
            self._events,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def _produce(self) -> None:
        try:
            # 包含模型建立连接、流式读取、工具与保存，避免只有首包超时。
            async with asyncio.timeout(self._timeout):
                await self._run_agent()
            if not self._io.closed:
                await self._io.emit_error("回复未完整生成，请重试")
        except TimeoutError:
            await self._io.emit_error("回复生成超时，请稍后重试")
        except Exception as exc:
            # 供应商异常可能带请求正文或凭据，只记录类型。
            logger.warning("chat stream failed type=%s", type(exc).__name__)
            await self._io.emit_error("回复生成失败，请稍后重试")
        finally:
            await self._io.close()

    async def _stream_events(self) -> AsyncGenerator[str, None]:
        try:
            await self._io.emit_session_id(self._session_id)
            self._producer = asyncio.create_task(self._produce())
            self._reader = asyncio.create_task(self._io.next_event())
            while True:
                done, _ = await asyncio.wait({self._reader}, timeout=self._heartbeat_interval)
                if not done:
                    # 保留同一个队列读取任务，心跳与消息同时到达也不丢消息。
                    # ASGI 2.4+ 在发送失败时通知断线，空闲心跳也能触发回收。
                    yield ": keep-alive\n\n"
                    continue
                event = self._reader.result()
                if event is None:
                    break
                yield event
                self._reader = asyncio.create_task(self._io.next_event())
        finally:
            await self.aclose()

    async def _cleanup(self) -> None:
        self._io.cancel()
        tasks = [task for task in (self._reader, self._producer) if task is not None]
        for task in tasks:
            if not task.done():
                task.cancel()
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            await self._release()

    async def aclose(self) -> None:
        # 生成器结束和 ASGI 发送失败可能先后触发清理，只释放一次。
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup())
        # Starlette 断线会取消 AnyIO scope；清理不能在第一个 await 被再次取消。
        with anyio.CancelScope(shield=True):
            await asyncio.shield(self._cleanup_task)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            # 唯一的 receive 消费者由 StreamingResponse 管理，禁止另行轮询 Request。
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                try:
                    # send 失败时 async for 不会自动关闭暂停在 yield 的生成器。
                    await self._events.aclose()
                finally:
                    # 即使响应头发送失败、生成器尚未开始，也必须释放路由已占用的名额。
                    await self.aclose()
