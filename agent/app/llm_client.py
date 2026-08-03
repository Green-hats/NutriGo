"""
LLM 客户端 — Agent Loop（流式版本）
"""
import json
import logging
import litellm
from app.config import settings
from app.chat_io import ChatIO
from app.conversation import Conversation
from app.tools import ToolRegistry

logger = logging.getLogger("uvicorn")
litellm.drop_params = True


async def run_agent_loop(conv: Conversation, tools: ToolRegistry, chat_io: ChatIO) -> None:
    tools_list = tools.to_openai_format() if tools._tools else None

    for iteration in range(settings.MAX_AGENT_ITERATIONS):
        logger.info(f"[Agent] 第 {iteration+1} 轮")
        kwargs = _build_kwargs(conv.to_messages(), tools_list, stream=True)

        try:
            response = await litellm.acompletion(**kwargs)
        except Exception as e:
            logger.error(f"[Agent] LLM 调用失败: {e}")
            await chat_io.emit_error(f"LLM 调用失败: {str(e)}")
            return

        # 收集流式响应
        content = ""
        tool_call_buffer: dict[int, dict] = {}

        async for chunk in response:
            delta = chunk.choices[0].delta

            # 文字内容 → 直接推送
            if delta.content:
                content += delta.content
                await chat_io.emit_chunk(delta.content)

            # 工具调用 → 累积（可能跨多个 chunk）
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_call_buffer:
                        tool_call_buffer[idx] = {
                            "id": tc.id or "",
                            "function": {"name": "", "arguments": ""},
                        }
                    buf = tool_call_buffer[idx]
                    if tc.id:
                        buf["id"] = tc.id
                    if tc.function and tc.function.name:
                        buf["function"]["name"] += tc.function.name
                    if tc.function and tc.function.arguments:
                        buf["function"]["arguments"] += tc.function.arguments

        # 流式输出完成 → 有工具调用则执行
        if tool_call_buffer:
            tool_calls_list = list(tool_call_buffer.values())
            tool_names = [t["function"]["name"] for t in tool_calls_list]
            logger.info(f"[Agent] 工具调用: {tool_names}")

            conv.add_assistant_message(content or None)

            openai_tool_calls = []
            for tc in tool_calls_list:
                openai_tool_calls.append({
                    "id": tc["id"],
                    "type": "function",
                    "function": tc["function"],
                })
            conv.messages[-1] = {**conv.messages[-1], "tool_calls": openai_tool_calls}

            await chat_io.emit_thinking("正在查询数据...")
            for tc in tool_calls_list:
                name = tc["function"]["name"]
                args = tc["function"]["arguments"]
                await chat_io.emit_tool_call(name, args)
                registered = tools.get(name)
                if registered:
                    result = await registered.execute_async(args)
                else:
                    result = f"未知工具: {name}"
                await chat_io.emit_tool_result(name, result)
                conv.add_tool_result(tc["id"], name, result)
            continue

        # 有内容 → 最终回复
        if content:
            conv.add_assistant_message(content)
            await conv.save()
            await chat_io.emit_done()
            return

        # 空响应
        await chat_io.emit_error("LLM 未返回有效内容")
        return

    await chat_io.emit_error(f"Agent 循环超过 {settings.MAX_AGENT_ITERATIONS} 次上限")


def _build_kwargs(messages: list[dict], tools: list[dict] | None, stream: bool) -> dict:
    kwargs = {"model": settings.LLM_MODEL, "messages": messages, "stream": stream}
    if settings.LLM_API_KEY:
        kwargs["api_key"] = settings.LLM_API_KEY
    if settings.LLM_BASE_URL:
        kwargs["api_base"] = settings.LLM_BASE_URL
    if tools:
        kwargs["tools"] = tools
    return kwargs
