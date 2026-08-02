"""
LLM 客户端 — Agent Loop 核心实现

Agent Loop 是 AI Agent 的"大脑循环"：

  用户发消息
      │
      ▼
  ┌─ 调用 LLM（带工具列表）─────────────────────┐
  │                                              │
  │  LLM 返回了什么？                              │
  │  ├── 有 tool_calls → 执行工具 → 结果追加到对话 → 回到 ┐
  │  └── 有 content   → 流式输出给用户 → 结束            │
  │                                                      │
  └──────────────────────────────────────────────────────┘

防止死循环：最多循环 MAX_AGENT_ITERATIONS 次（默认 10 次）
"""

import litellm
from app.config import settings
from app.chat_io import ChatIO
from app.conversation import Conversation
from app.tools import ToolRegistry


# 让 litellm 在流式模式下也正确处理 tool_calls
litellm.drop_params = True


async def run_agent_loop(
    conv: Conversation,
    tools: ToolRegistry,
    chat_io: ChatIO,
) -> None:
    """
    执行 Agent 主循环。

    参数：
      conv   — 对话状态（含历史消息）
      tools  — 工具注册表
      chat_io — 输出通道（SSE 或其他）
    """
    tools_list = tools.to_openai_format() if tools._tools else None

    for iteration in range(settings.MAX_AGENT_ITERATIONS):
        # ---- 调用 LLM ----
        kwargs = _build_llm_kwargs(conv.to_messages(), tools_list)
        try:
            response = await litellm.acompletion(**kwargs)
        except Exception as e:
            await chat_io.emit_error(f"LLM 调用失败: {str(e)}")
            return

        choice = response.choices[0]

        # ---- 情况 1：LLM 决定调用工具 ----
        if choice.message.tool_calls:
            await _handle_tool_calls(conv, tools, chat_io, choice.message.tool_calls)
            continue  # 工具结果已加入对话，再问一轮 LLM

        # ---- 情况 2：LLM 返回了文字回复 → 流式输出 ----
        if choice.message.content:
            await _stream_final_response(conv, chat_io, kwargs, choice.message.content)
            await conv.save()
            await chat_io.emit_done()
            return

        # ---- 情况 3：既没文字也没工具（极少发生）----
        await chat_io.emit_error("LLM 未返回有效内容")
        return

    # 超过最大轮次
    await chat_io.emit_error(f"Agent 循环超过 {settings.MAX_AGENT_ITERATIONS} 次上限，已停止")


def _build_llm_kwargs(messages: list[dict], tools: list[dict] | None) -> dict:
    """构造传给 litellm 的参数"""
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
    """处理 LLM 的工具调用请求"""
    await chat_io.emit_thinking("正在查询数据...")

    # 1. 先添加 assistant 消息（含 tool_calls），这是 OpenAI 要求的格式
    openai_tool_calls = []
    for tc in tool_calls:
        openai_tool_calls.append({
            "id": tc.id,
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments,
            },
        })
    conv.add_assistant_tool_calls(openai_tool_calls)

    # 2. 逐个执行工具
    for tc in tool_calls:
        tool_name = tc.function.name
        arguments = tc.function.arguments
        await chat_io.emit_tool_call(tool_name, arguments)

        registered = tools.get(tool_name)
        if registered:
            result = registered.execute(arguments)
        else:
            result = f"未知工具: {tool_name}"

        await chat_io.emit_tool_result(tool_name, result)
        conv.add_tool_result(tc.id, tool_name, result)


async def _stream_final_response(
    conv: Conversation,
    chat_io: ChatIO,
    original_kwargs: dict,
    fallback_content: str,
) -> None:
    """
    流式输出最终回复。

    重新调用 LLM（stream=True），逐 token 推送。
    如果流式调用失败，回退到非流式获取到的内容。
    """
    # 拿到完整回复后，把 assistant 消息加入对话
    conv.add_assistant_message(fallback_content)

    try:
        stream_kwargs = {**original_kwargs, "stream": True}
        response = await litellm.acompletion(**stream_kwargs)

        collected = ""
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                collected += delta.content
                await chat_io.emit_chunk(delta.content)

        # 如果流式输出成功，更新对话里的消息为完整内容
        if collected:
            conv.messages[-1]["content"] = collected

    except Exception:
        # 流式失败：用非流式拿到的内容作为回退，一次性推送
        await chat_io.emit_chunk(fallback_content)
