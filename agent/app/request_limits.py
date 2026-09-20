"""在 FastAPI 解析 JSON 前限制请求字节、读取时间及同时缓冲的请求数。"""

import asyncio

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestLimits:
    def __init__(self, app: ASGIApp, max_bytes: int = 64 * 1024, timeout: float = 15) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.timeout = timeout
        self.reading = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))

        async def reject(status: int, message: str) -> None:
            await JSONResponse({"detail": message}, status_code=status)(scope, receive, send)

        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            await reject(400, "请求长度无效")
            return
        if length < 0 or length > self.max_bytes:
            await reject(413, "请求内容过大，请缩小后重试")
            return
        if headers.get(b"content-encoding", b"identity").lower() != b"identity":
            await reject(415, "不支持压缩请求体")
            return
        # GET SSE 无请求体时不读取 receive，不抢占框架的断线监听。
        no_body = not length and b"transfer-encoding" not in headers
        if scope["method"] in {"GET", "HEAD", "OPTIONS"} and no_body:
            await self.app(scope, receive, send)
            return
        if self.reading >= 64:
            await reject(503, "服务器繁忙，请稍后重试")
            return
        self.reading += 1
        body = bytearray()
        try:
            async with asyncio.timeout(self.timeout):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > self.max_bytes:
                        await reject(413, "请求内容过大，请缩小后重试")
                        return
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            await reject(408, "上传请求超时，请重试")
            return
        finally:
            self.reading -= 1
        consumed = False

        async def replay() -> Message:
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
