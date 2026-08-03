"""
ChatIO 输出抽象层 — Agent 事件 → SSE 流
"""
import json
import asyncio
from typing import AsyncGenerator, Optional


class ChatIO:
    async def emit_chunk(self, text: str) -> None: ...
    async def emit_tool_call(self, tool_name: str, arguments: str) -> None: ...
    async def emit_tool_result(self, tool_name: str, result: str) -> None: ...
    async def emit_thinking(self, message: str = "思考中...") -> None: ...
    async def emit_done(self) -> None: ...
    async def emit_error(self, error: str) -> None: ...


class SSEChatIO(ChatIO):
    """使用 asyncio.Queue 实现真正的实时流式输出"""

    def __init__(self):
        self._queue: asyncio.Queue[tuple[str, Optional[str]]] = asyncio.Queue()

    async def _push(self, event: str, data: str = "") -> None:
        await self._queue.put((event, data))

    async def emit_chunk(self, text: str) -> None:
        await self._push("chunk", text)

    async def emit_tool_call(self, tool_name: str, arguments: str) -> None:
        await self._push("tool_call", json.dumps({"name": tool_name, "arguments": arguments}, ensure_ascii=False))

    async def emit_tool_result(self, tool_name: str, result: str) -> None:
        await self._push("tool_result", json.dumps({"name": tool_name, "result": result}, ensure_ascii=False))

    async def emit_thinking(self, message: str = "思考中...") -> None:
        await self._push("thinking", message)

    async def emit_done(self) -> None:
        await self._push("done", "")
        await self.close()

    async def emit_error(self, error: str) -> None:
        await self._push("error", error)
        await self.close()

    def _format(self, event: str, data: str) -> str:
        lines = [f"event: {event}"]
        for line in data.split("\n"):
            lines.append(f"data: {line}")
        return "\n".join(lines) + "\n\n"

    async def stream(self) -> AsyncGenerator[str, None]:
        """从队列实时读取事件并 yield，不等待全部收集"""
        while True:
            event, data = await self._queue.get()
            if event == "__done__":
                break
            yield self._format(event, data)

    async def close(self) -> None:
        await self._queue.put(("__done__", ""))
