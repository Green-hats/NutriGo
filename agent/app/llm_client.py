"""
LLM 客户端 — Agent Loop 核心实现
"""
import logging
import litellm
from app.config import settings
from app.chat_io import ChatIO
from app.conversation import Conversation
from app.tools import ToolRegistry

logger = logging.getLogger("uvicorn")
litellm.drop_params = True


async def run_agent_loop(
    conv: Conversation,
    tools: ToolRegistry,
    chat_io: ChatIO,
) -> None:
    tools_list = tools.to_openai_format() if tools._tools else None

    for iteration in range(settings.MAX_AGENT_ITERATIONS):
        logger.info(f"[Agent] 第 {iteration+1} 轮 LLM 调用")
        kwargs = _build_llm_kwargs(conv.to_messages(), tools_list)
        try:
            response = await litellm.acompletion(**kwargs)
        except Exception as e:
            logger.error(f"[Agent] LLM 调用失败: {e}")
            await chat_io.emit_error(f"LLM 调用失败: {str(e)}")
            return

        choice = response.choices[0]

        if choice.message.tool_calls:
            tool_names = [tc.function.name for tc in choice.message.tool_calls]
            logger.info(f"[Agent] 工具调用: {tool_names}")
            await _handle_tool_calls(conv, tools, chat_io, choice.message.tool_calls)
            continue

        if choice.message.content:
            logger.info(f"[Agent] 最终回复, 长度 {len(choice.message.content)}")
            conv.add_assistant_message(choice.message.content)
            # 直接推送内容（不做第二次流式调用，避免卡住）
            await chat_io.emit_chunk(choice.message.content)
            await conv.save()
            await chat_io.emit_done()
            return

        logger.warning(f"[Agent] LLM 返回空内容")
        await chat_io.emit_error("LLM 未返回有效内容")
        return

    logger.warning(f"[Agent] 超过 {settings.MAX_AGENT_ITERATIONS} 次上限")
    await chat_io.emit_error(f"Agent 循环超过 {settings.MAX_AGENT_ITERATIONS} 次上限，已停止")


def _build_llm_kwargs(messages: list[dict], tools: list[dict] | None) -> dict:
    kwargs = {
        "model": settings.LLM_MODEL,
        "messages": messages,
    }
    if settings.LLM_API_KEY:
        kwargs["api_key"] = settings.LLM_API_KEY
    if settings.LLM_BASE_URL:
        kwargs["api_base"] = settings.LLM_BASE_URL
    if tools:
        kwargs["tools"] = tools
    return kwargs


async def _handle_tool_calls(
    conv: Conversation,
    tools: ToolRegistry,
    chat_io: ChatIO,
    tool_calls: list,
) -> None:
    await chat_io.emit_thinking("正在查询数据...")

    openai_tool_calls = []
    for tc in tool_calls:
        openai_tool_calls.append({
            "id": tc.id,
            "type": "function",
            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
        })
    conv.add_assistant_tool_calls(openai_tool_calls)

    for tc in tool_calls:
        tool_name = tc.function.name
        arguments = tc.function.arguments
        await chat_io.emit_tool_call(tool_name, arguments)

        registered = tools.get(tool_name)
        if registered:
            result = await registered.execute_async(arguments)
        else:
            result = f"未知工具: {tool_name}"

        await chat_io.emit_tool_result(tool_name, result)
        conv.add_tool_result(tc.id, tool_name, result)
