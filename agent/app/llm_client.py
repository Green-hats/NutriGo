"""
LLM 客户端 — Agent Loop（流式版本）
"""
import asyncio
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
    import time as _time
    tools_list = tools.to_openai_format() if tools._tools else None
    start_total = _time.monotonic()
    logger.info(f"对话开始 session={conv.session_id} user_id={conv.user_id}")

    for iteration in range(settings.MAX_AGENT_ITERATIONS):
        if chat_io.cancelled:
            logger.info("已取消，退出循环")
            return
        iter_start = _time.monotonic()
        logger.info(f"第 {iteration+1} 轮")
        kwargs = _build_kwargs(conv.to_messages(), tools_list, stream=True)
        # 网络抖动时自动重试，最多 2 次
        response = None
        for attempt in range(3):
            try:
                response = await asyncio.wait_for(
                    litellm.acompletion(**kwargs),
                    timeout=settings.LLM_TIMEOUT,
                )
                break
            except asyncio.TimeoutError:
                logger.warning(f"第 {iteration+1} 轮 LLM 超时 (尝试 {attempt+1}/3)")
            except Exception as e:
                logger.warning(f"第 {iteration+1} 轮 LLM 调用失败: {e} (尝试 {attempt+1}/3)")
                await asyncio.sleep(1)
        if response is None:
            await chat_io.emit_error("LLM 调用多次失败，请稍后重试")
            return

        # 收集流式响应
        content = ""
        thinking = ""
        tool_call_buffer: dict[int, dict] = {}

        async for chunk in response:
            if chat_io.cancelled:
                logger.info("客户端已断开，停止接收")
                break
            delta = chunk.choices[0].delta

            # 思维链 → 流式推送 thinking 事件
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                thinking += reasoning
                await chat_io.emit_thinking(reasoning)

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
            logger.info(f"工具调用: {tool_names}")

            conv.add_assistant_message(content or None, thinking=thinking)

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
                if chat_io.cancelled:
                    logger.info("客户端断开，停止执行工具")
                    break
                name = tc["function"]["name"]
                args = tc["function"]["arguments"]
                await chat_io.emit_tool_call(name, args)
                registered = tools.get(name)
                t0 = _time.monotonic()
                if registered:
                    result = await registered.execute_async(args, defaults={"user_id": conv.user_id})
                else:
                    result = f"未知工具: {name}"
                logger.info(f"工具 {name} 执行 {_time.monotonic()-t0:.1f}s 结果{len(result)}字符")
                await chat_io.emit_tool_result(name, result)
                conv.add_tool_result(tc["id"], name, result)
            logger.info(f"第 {iteration+1} 轮完成，耗时 {_time.monotonic()-iter_start:.1f}s")
            continue

        # 有内容 → 最终回复
        if content:
            conv.add_assistant_message(content, thinking=thinking)
            await conv.save()
            await chat_io.emit_done()
            logger.info(f"对话完成 共{iteration+1}轮 总耗时{_time.monotonic()-start_total:.1f}s")
            return

        # 空响应
        await chat_io.emit_error("LLM 未返回有效内容")
        return

    logger.warning(f"对话超轮数上限 {settings.MAX_AGENT_ITERATIONS}，终止")
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
