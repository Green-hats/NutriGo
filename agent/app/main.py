"""
FastAPI 应用入口

启动方式：
  uv run python -m app.main

或：
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

API 路由：
  GET  /api/chat?message=xxx&session_id=123    — SSE 流式对话
  GET  /api/sessions                            — 列出会话
  GET  /api/sessions/:id                        — 获取会话详情
  DELETE /api/sessions/:id                      — 删除会话
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app import db
from app.chat_io import SSEChatIO
from app.config import settings
from app.conversation import Conversation
from app.llm_client import run_agent_loop
from app.models import SessionInfo, SessionDetail
from app.tools import registry as tool_registry


# ============================================================
# 应用生命周期
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """服务启动/关闭时的钩子"""
    await db.init_db()  # 启动时建表
    print(f"  LLM 模型: {settings.LLM_MODEL}")
    print(f"  Go 后端:  {settings.GO_BACKEND_URL}")
    yield  # 服务运行中...
    # 关闭时清理（目前无需操作）


app = FastAPI(
    title="NutriGo Agent",
    version="0.1.0",
    lifespan=lifespan,
)

# ============================================================
# SSE 对话路由 — 核心接口
# ============================================================

@app.get("/api/chat")
async def chat(
    request: Request,
    message: str = Query(..., description="用户消息"),
    session_id: int | None = Query(None, description="会话ID，不传则创建新会话"),
):
    """
    发起一次对话，以 SSE 流式返回 AI 回复。

    前端使用 EventSource 连接这个接口：
      const sse = new EventSource('/api/chat?message=今天吃什么');
      sse.addEventListener('chunk', e => output.textContent += e.data);
      sse.addEventListener('done', () => sse.close());

    SSE 事件类型：
      chunk       — AI 回复的一个文字片段
      tool_call   — Agent 正在调用工具
      tool_result — 工具执行结果
      done        — 本轮对话结束
      error       — 发生错误
    """

    # 1. 加载或创建会话
    if session_id:
        conv = await Conversation.load(session_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="会话不存在")
    else:
        conv = await Conversation.create_new()

    # 2. 把用户消息加入对话并保存
    conv.add_user_message(message)
    await conv.save()

    # 3. 创建 SSE 输出通道
    chat_io = SSEChatIO()

    # 4. 启动 Agent Loop（后台运行，结果通过 chat_io 输出）
    #    由于 StreamingResponse 需要同步消费 generator，
    #    我们用事件机制让 run_agent_loop 和 stream 并行工作

    async def event_generator():
        """把 run_agent_loop 和 SSE 流桥接起来"""
        import asyncio
        # 启动 Agent Loop 作为后台任务
        task = asyncio.create_task(run_agent_loop(conv, tool_registry, chat_io))
        # 等待 Agent Loop 完成
        await task
        # Agent 完成后，输出所有缓冲的 SSE 事件
        async for sse_event in chat_io.stream():
            # 检查客户端是否断开
            if await request.is_disconnected():
                break
            yield sse_event

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",     # 禁用 nginx 缓冲
        },
    )


# ============================================================
# 会话管理路由
# ============================================================

@app.get("/api/sessions", response_model=list[SessionInfo])
async def list_sessions():
    """列出所有会话（按更新时间倒序）"""
    return await db.list_sessions()


@app.get("/api/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int):
    """获取指定会话的完整消息历史"""
    row = await db.get_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    import json
    return SessionDetail(
        id=row["id"],
        name=row["name"],
        user_id=row.get("user_id"),
        system_msg=row["system_msg"],
        messages=json.loads(row["messages"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int):
    """删除会话"""
    if not await db.delete_session(session_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"message": "删除成功"}
