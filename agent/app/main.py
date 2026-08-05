"""
FastAPI 应用入口

启动方式：
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

API 路由：
  GET  /api/chat            — SSE 流式对话
  GET  /api/sessions         — 列出会话
  GET  /api/sessions/:id     — 获取会话详情
  DELETE /api/sessions/:id   — 删除会话
  POST /api/identify-food    — 图片识别食物（新增）
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import db
from app.auth import extract_user_id
from app.chat_io import SSEChatIO
from app.config import settings
from app.conversation import Conversation
from app.llm_client import run_agent_loop
from app.models import SessionInfo, SessionDetail
from app.tools import registry as tool_registry

# recognition 模块
from recognition.db import init_db as init_nutrition_db, seed_data, get_by_name, get_portion, list_names
from recognition.go_client import go_client
from recognition.multimodal import identify
from recognition.nutrition import calculate_intake
from recognition.rag import init_rag

logger = logging.getLogger("uvicorn")


# ============================================================
# 应用生命周期
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """服务启动/关闭"""
    await db.init_db()                 # agent.db — sessions 表
    await init_nutrition_db()          # nutrition.db — 食物营养
    await seed_data()                  # 首次启动插入种子数据
    init_rag()                         # ChromaDB — 营养知识库
    logger.info(f"LLM 模型: {settings.LLM_MODEL}")
    logger.info(f"Go 后端:  {settings.GO_BACKEND_URL}")
    yield


app = FastAPI(title="NutriGo Agent", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ============================================================
# SSE 对话路由
# ============================================================

@app.get("/api/chat")
async def chat(
    request: Request,
    message: str = Query(..., description="用户消息"),
    session_id: int | None = Query(None, description="会话ID"),
):
    """SSE 流式对话（需 JWT）"""

    # 从 Authorization 头解析用户，不再信任 URL 里的 user_id
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")

    if session_id:
        conv = await Conversation.load(session_id, user_id=user_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="会话不存在")
    else:
        conv = await Conversation.create_new(user_id=user_id)

    conv.add_user_message(message)
    await conv.save()

    chat_io = SSEChatIO()

    async def event_generator():
        # Agent 作为后台任务运行
        task = asyncio.create_task(run_agent_loop(conv, tool_registry, chat_io))
        # 同时从队列实时读取 SSE 事件并 yield
        async for sse_event in chat_io.stream():
            if await request.is_disconnected():
                # 客户端断开：标记取消 + 取消任务，让 agent 在检查点快速退出
                chat_io.cancel()
                task.cancel()
                break
            yield sse_event
        if not task.done():
            task.cancel()
        # 等待任务真正结束（cancel 后正常返回，异常被吞掉）
        try:
            await task
        except BaseException:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# 会话管理路由
# ============================================================

@app.get("/api/sessions", response_model=list[SessionInfo])
async def list_sessions(request: Request):
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    return await db.list_sessions(user_id=user_id)


@app.get("/api/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int, request: Request):
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    row = await db.get_session(session_id, user_id=user_id)
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
async def delete_session(session_id: int, request: Request):
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    if not await db.delete_session(session_id, user_id=user_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"message": "删除成功"}


# ============================================================
# 食物识别路由（新增）
# ============================================================

class IdentifyRequest(BaseModel):
    image_id: int


@app.post("/api/identify-food")
async def identify_food(req: IdentifyRequest):
    """
    识别食物图片，返回 Top-5 候选 + 营养数据 + 默认份量。

    流程：
      1. 从 Go 后端获取图片二进制
      2. Chinese-CLIP 识别
      3. 查 nutrition.db 获取营养和份量
    """
    # 1. 从 Go 获取图片
    try:
        image_bytes = await go_client.get_image_data(req.image_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"获取图片失败 (image_id={req.image_id}): {e}")

    # 2. CLIP 识别（仅用家常菜，避免 8407 个 labels 太慢）
    labels = await list_names(category="家常菜")
    if not labels:
        raise HTTPException(status_code=500, detail="营养数据库中无家常菜数据")

    try:
        candidates = identify(image_bytes, labels, top_k=5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图片识别失败: {e}")

    # 3. 查询营养 + 份量
    results = []
    for c in candidates:
        name = c["name"]
        nutrition = await get_by_name(name) or {}
        portion = await get_portion(name)
        results.append({
            "name": name,
            "confidence": c["confidence"],
            "nutrition_per_100g": {
                "calories": nutrition.get("calories", 0),
                "protein_g": nutrition.get("protein", 0),
                "fat_g": nutrition.get("fat", 0),
                "carbs_g": nutrition.get("carbohydrate", 0),
            },
            "default_portion": portion,
        })

    return results


# ============================================================
# 营养计算辅助路由（前端计算实际摄入用）
# ============================================================

class IntakeRequest(BaseModel):
    food_name: str
    grams: float


@app.post("/api/calculate-intake")
async def calc_intake(req: IntakeRequest):
    """根据食物名和克数计算实际摄入营养"""
    result = await calculate_intake(req.food_name, req.grams)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
