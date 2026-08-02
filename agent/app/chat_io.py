"""
ChatIO 输出抽象层 — 将 Agent 的输出事件分发给不同"渲染器"

为什么要抽象？
  - 终端模式下：print() 到控制台
  - Web 模式下：yield SSE 事件给 FastAPI StreamingResponse

ChatIO 定义了 Agent 运行过程中产生的 6 种事件：
  1. chunk         — LLM 回复的一个文字片段（逐 token）
  2. tool_call     — LLM 决定调用某个工具
  3. tool_result   — 工具执行完毕，返回结果
  4. thinking      — Agent 正在思考/处理中（可选，用于 UI 状态提示）
  5. done          — 本轮对话结束
  6. error         — 发生错误
"""

from typing import AsyncGenerator, Optional
import json


class ChatIO:
    """基类 — 定义了输出事件的抽象接口"""

    async def emit_chunk(self, text: str) -> None:
        """LLM 输出的一个 token"""

    async def emit_tool_call(self, tool_name: str, arguments: str) -> None:
        """LLM 决定调用工具"""

    async def emit_tool_result(self, tool_name: str, result: str) -> None:
        """工具执行结果"""

    async def emit_thinking(self, message: str = "思考中...") -> None:
        """Agent 正在内部处理"""

    async def emit_done(self) -> None:
        """本轮回复结束"""

    async def emit_error(self, error: str) -> None:
        """发生错误"""


class SSEChatIO(ChatIO):
    """
    SSE（Server-Sent Events）输出实现

    通过 async generator 产生符合 SSE 协议的事件流。
    FastAPI 的 StreamingResponse 会消费这个 generator，
    每个 yield 自动以 "data: ...\n\n" 格式发给前端。

    前端用 EventSource 接收：
      const sse = new EventSource('/api/chat?message=你好');
      sse.addEventListener('chunk', e => appendToChat(e.data));
      sse.addEventListener('done',  e => sse.close());
    """

    def __init__(self):
        self._queue: list[tuple[str, Optional[str]]] = []

    async def _push(self, event: str, data: str = "") -> None:
        """将事件推入队列"""
        self._queue.append((event, data))

    async def emit_chunk(self, text: str) -> None:
        await self._push("chunk", text)

    async def emit_tool_call(self, tool_name: str, arguments: str) -> None:
        await self._push("tool_call", json.dumps({
            "name": tool_name, "arguments": arguments
        }, ensure_ascii=False))

    async def emit_tool_result(self, tool_name: str, result: str) -> None:
        await self._push("tool_result", json.dumps({
            "name": tool_name, "result": result
        }, ensure_ascii=False))

    async def emit_thinking(self, message: str = "思考中...") -> None:
        await self._push("thinking", message)

    async def emit_done(self) -> None:
        await self._push("done", "")

    async def emit_error(self, error: str) -> None:
        await self._push("error", error)

    async def stream(self) -> AsyncGenerator[str, None]:
        """
        SSE 事件生成器 — 被 FastAPI StreamingResponse 消费。

        产出格式：
          event: chunk
          data: 你好

          event: done
          data:

        空事件表示 SSE 流结束。
        """
        for event, data in self._queue:
            lines = [f"event: {event}"]
            for line in data.split("\n"):
                lines.append(f"data: {line}")
            yield "\n".join(lines) + "\n\n"
