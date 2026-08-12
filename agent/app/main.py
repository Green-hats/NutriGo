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
import json
import logging
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from app import db
from app.auth import extract_user_id
from app.chat_io import SSEChatIO
from app.config import settings
from app.conversation import Conversation
from app.llm_client import run_agent_loop
from app.logging_setup import configure_logging, new_request_id, request_id_var
from app.models import PagedSessions, SessionDetail
from app.rate_limit import acquire_user, get_session_lock, prune_session_locks, release_user
from app.tools import registry as tool_registry
from recognition.db import get_by_name, get_portion, list_names, seed_data

# recognition 模块
from recognition.db import init_db as init_nutrition_db
from recognition.go_client import go_client
from recognition.multimodal import identify
from recognition.nutrition import calculate_intake
from recognition.rag import init_rag

logger = logging.getLogger("uvicorn")


# ============================================================
# 应用生命周期
# ============================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """服务启动/关闭"""
    configure_logging()
    await db.init_db()                 # agent.db — sessions 表
    await init_nutrition_db()          # nutrition.db — 食物营养
    await seed_data()                  # 首次启动插入种子数据
    init_rag()                         # ChromaDB — 营养知识库
    logger.info(f"LLM 模型: {settings.LLM_MODEL}")
    logger.info(f"Go 后端:  {settings.GO_BACKEND_URL}")

    # 后台：周期清理空闲会话锁，防内存泄漏
    async def _lock_cleanup_loop() -> None:
        while True:
            await asyncio.sleep(10 * 60)
            removed = await prune_session_locks()
            if removed:
                logger.info(f"清理空闲会话锁 {removed} 个")

    cleanup_task = asyncio.create_task(_lock_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="NutriGo Agent", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 请求日志中间件（结构化：method / path / status / 耗时 / 客户端 IP）
# ============================================================

@app.middleware("http")
async def request_logging(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    start = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("请求处理异常 method=%s path=%s", request.method, request.url.path)
        raise
    duration_ms = (time.monotonic() - start) * 1000
    client_ip = request.client.host if request.client else "-"
    logger.info(
        "http request method=%s path=%s status=%d duration_ms=%.1f client_ip=%s",
        request.method, request.url.path, response.status_code, duration_ms, client_ip,
    )
    return response


# ============================================================
# 健康检查 / 就绪探针（无鉴权，供负载均衡/容器编排探活）
# ============================================================

@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/ready")
async def ready() -> dict:
    """就绪探针：数据库可连接即就绪"""
    try:
        await db.ping()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"数据库不可用: {e}") from e
    return {"status": "ready"}


# ============================================================
# SSE 对话路由
# ============================================================

async def _load_or_create_conv(session_id: int | None, user_id: int, message: str) -> Conversation:
    """加载已有会话或创建新会话，添加用户消息。会话级锁防并发写入冲突。"""
    if session_id:
        # 同一会话串行处理，避免并发 save 互相覆盖
        lock = await get_session_lock(session_id)
        async with lock:
            conv = await Conversation.load(session_id, user_id=user_id)
            if conv is None:
                raise HTTPException(status_code=404, detail="会话不存在")
            conv.add_user_message(message)
            await conv.save()
            return conv
    conv = await Conversation.create_new(user_id=user_id)
    conv.add_user_message(message)
    await conv.save()
    return conv


@app.get("/api/chat")
async def chat(
    request: Request,
    message: str = Query(..., description="用户消息"),
    session_id: int | None = Query(None, description="会话ID"),
) -> StreamingResponse:
    """SSE 流式对话（需 JWT）"""

    # 从 Authorization 头解析用户，不再信任 URL 里的 user_id
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")

    # 输入长度限制，防 token 轰炸
    if len(message) > settings.MAX_MESSAGE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"消息过长（最多 {settings.MAX_MESSAGE_LENGTH} 字符）",
        )

    # 生成请求 ID，注入 contextvars（agent 循环子任务自动继承）
    request_id_var.set(new_request_id())

    # 用户级并发限制：同一用户同时只允许 1 个活跃对话
    if not await acquire_user(user_id):
        logger.warning(f"user={user_id} 并发超限，拒绝请求")
        raise HTTPException(status_code=429, detail="您有对话正在进行中，请等待完成后再试")

    try:
        conv = await _load_or_create_conv(session_id, user_id, message)
    except BaseException:
        await release_user(user_id)
        raise

    chat_io = SSEChatIO()
    return _sse_response(request, conv, chat_io, user_id)


@app.post("/api/sessions/{session_id}/regenerate")
async def regenerate(session_id: int, request: Request) -> StreamingResponse:
    """重新生成最后一条回复：回滚到最后一次提问，重新跑 agent loop"""
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")

    request_id_var.set(new_request_id())

    # 用户级并发限制
    if not await acquire_user(user_id):
        logger.warning(f"user={user_id} 并发超限，拒绝请求")
        raise HTTPException(status_code=429, detail="您有对话正在进行中，请等待完成后再试")

    try:
        # 会话锁内回滚
        lock = await get_session_lock(session_id)
        async with lock:
            removed = await db.rollback_last_exchange(session_id, user_id=user_id)
            if removed < 0:
                raise HTTPException(status_code=404, detail="会话不存在")
            if removed == 0:
                raise HTTPException(status_code=409, detail="暂无可重新生成的内容")
            conv = await Conversation.load(session_id, user_id=user_id)
            if conv is None:
                raise HTTPException(status_code=404, detail="会话不存在")
    except BaseException:
        await release_user(user_id)
        raise

    chat_io = SSEChatIO()
    return _sse_response(request, conv, chat_io, user_id)


def _sse_response(request: Request, conv: Conversation, chat_io: SSEChatIO,
                  user_id: int) -> StreamingResponse:
    """生成 SSE 流式响应：后台跑 agent loop，实时推送事件；断开/结束释放用户名额"""
    async def event_generator() -> AsyncGenerator[str, None]:
        # 先推送会话 ID，前端拿到后能触发"重新生成"等功能
        await chat_io.emit_session_id(conv.session_id)
        # Agent 作为后台任务运行
        task = asyncio.create_task(run_agent_loop(conv, tool_registry, chat_io))
        try:
            # 同时监听"下一个事件"和"客户端断开"，任一先到即处理
            while True:
                event_task = asyncio.create_task(chat_io.next_event())
                disconnected_task = asyncio.create_task(request.is_disconnected())
                done, pending = await asyncio.wait(
                    {event_task, disconnected_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                # 取消另一个未完成的任务
                for p in pending:
                    p.cancel()

                if disconnected_task in done and disconnected_task.result():
                    # 客户端断开：取消 agent，退出
                    chat_io.cancel()
                    task.cancel()
                    break

                if event_task in done:
                    sse_event = event_task.result()
                    if sse_event is None:
                        break  # 流正常结束
                    yield sse_event
        finally:
            if not task.done():
                task.cancel()
            try:
                await task
            except BaseException:
                pass
            await release_user(user_id)

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

@app.get("/api/sessions", response_model=PagedSessions)
async def list_sessions(request: Request) -> dict:
    """会话列表（分页：limit/offset，返回 { items, total, limit, offset }）"""
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")

    try:
        limit = int(request.query_params.get("limit", 20))
        offset = int(request.query_params.get("offset", 0))
    except ValueError:
        raise HTTPException(status_code=400, detail="limit/offset 必须是整数") from None
    limit = min(max(limit, 1), 100)
    offset = max(offset, 0)

    items = await db.list_sessions(limit=limit, offset=offset, user_id=user_id)
    total = await db.count_sessions(user_id=user_id)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int, request: Request) -> SessionDetail:
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    row = await db.get_session(session_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="会话不存在")
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
async def delete_session(session_id: int, request: Request) -> dict:
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    if not await db.delete_session(session_id, user_id=user_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"message": "删除成功"}


class RenameRequest(BaseModel):
    name: str


@app.patch("/api/sessions/{session_id}")
async def rename_session(session_id: int, req: RenameRequest, request: Request) -> dict:
    """手动重命名会话"""
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="会话名称不能为空")
    if not await db.update_session_name(session_id, req.name.strip(), user_id=user_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"message": "重命名成功"}


# ============================================================
# 食物识别路由（新增）
# ============================================================

class IdentifyRequest(BaseModel):
    image_id: int


# 图片识别结果缓存：image_id -> (expire_at, results)
# 同一张图短时间重复识别直接返回，避免重复跑 CLIP（~7s）
_identify_cache: dict[int, tuple[float, list]] = {}
_IDENTIFY_CACHE_TTL = 3600        # 缓存 1 小时
_IDENTIFY_CACHE_MAX = 500         # 最多缓存条数，防止内存膨胀


def _cache_get(image_id: int) -> list | None:
    item = _identify_cache.get(image_id)
    if item is None:
        return None
    expire_at, results = item
    if time.time() > expire_at:
        _identify_cache.pop(image_id, None)
        return None
    return results


def _cache_set(image_id: int, results: list) -> None:
    if len(_identify_cache) >= _IDENTIFY_CACHE_MAX:
        # 满了就清掉过期项；仍满则整体清空（简单策略）
        now = time.time()
        expired = [k for k, (e, _) in _identify_cache.items() if e < now]
        for k in expired:
            _identify_cache.pop(k, None)
        if len(_identify_cache) >= _IDENTIFY_CACHE_MAX:
            _identify_cache.clear()
    _identify_cache[image_id] = (time.time() + _IDENTIFY_CACHE_TTL, results)


@app.post("/api/identify-food")
async def identify_food(req: IdentifyRequest, request: Request) -> list:
    """
    识别食物图片，返回 Top-5 候选 + 营养数据 + 默认份量。

    流程：
      1. 从 Go 后端获取图片二进制
      2. Chinese-CLIP 识别（放线程池，避免阻塞事件循环）
      3. 查 nutrition.db 获取营养和份量
    """
    # 0. JWT 鉴权
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")

    # 0.5 缓存命中直接返回，跳过 CLIP 推理
    cached = _cache_get(req.image_id)
    if cached is not None:
        return cached

    # 1. 从 Go 获取图片
    try:
        image_bytes = await go_client.get_image_data(req.image_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"获取图片失败 (image_id={req.image_id}): {e}") from e

    # 2. CLIP 识别（仅用家常菜，避免 8407 个 labels 太慢）
    #    同步推理放到线程池，不阻塞 asyncio 事件循环
    labels = await list_names(category="家常菜")
    if not labels:
        raise HTTPException(status_code=500, detail="营养数据库中无家常菜数据")

    try:
        candidates = await asyncio.to_thread(identify, image_bytes, labels, 5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图片识别失败: {e}") from e

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

    _cache_set(req.image_id, results)
    return results


# ============================================================
# 营养计算辅助路由（前端计算实际摄入用）
# ============================================================

class IntakeRequest(BaseModel):
    food_name: str
    grams: float


@app.post("/api/calculate-intake")
async def calc_intake(req: IntakeRequest, request: Request) -> dict:
    """根据食物名和克数计算实际摄入营养（需 JWT）"""
    user_id = extract_user_id(request.headers.get("Authorization"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    result = await calculate_intake(req.food_name, req.grams)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
