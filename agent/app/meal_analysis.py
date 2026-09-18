"""有归属校验、并发限制和短期缓存的照片分析接口。"""

import logging
import time

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import require_user_id
from app.config import settings
from recognition.go_client import go_client
from recognition.meal import MealAnalysis, analyze_meal, vision_key

router = APIRouter()
logger = logging.getLogger("uvicorn")
cache: dict[tuple[int, int], tuple[float, MealAnalysis]] = {}
active_users: set[int] = set()


class MealRequest(BaseModel):
    image_id: int = Field(gt=0)


@router.post("/api/analyze-meal", response_model=MealAnalysis)
async def analyze(req: MealRequest, request: Request) -> MealAnalysis:
    user_id = await require_user_id(request.headers.get("Authorization"))
    if not settings.AI_ENABLED or not settings.FOOD_RECOGNITION_ENABLED or not vision_key():
        raise HTTPException(409, "照片分析尚未配置，请先使用手动记录。")
    try:
        meta = await go_client.get_image_meta(req.image_id)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(404, "图片不存在，请重新选择照片。") from e
        raise HTTPException(502, "无法验证照片，请稍后重试。") from e
    except httpx.RequestError as e:
        raise HTTPException(502, "无法验证照片，请稍后重试。") from e
    if meta.get("user_id") != user_id:
        raise HTTPException(403, "无权分析他人的照片")

    key = (user_id, req.image_id)
    cached = cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    if user_id in active_users or len(active_users) >= 4:
        raise HTTPException(429, "照片正在分析中，请稍后重试。")
    active_users.add(user_id)
    try:
        result = await analyze_meal(await go_client.get_image_data(req.image_id))
        if len(cache) >= 500:
            cache.pop(next(iter(cache)))
        cache[key] = (time.monotonic() + 3600, result)
        return result
    except (TimeoutError, httpx.TimeoutException) as e:
        raise HTTPException(504, "照片分析超时，请重试或手动记录。") from e
    except Exception as e:
        # 不记录供应商响应正文、照片或模型输出，避免数据和凭据进入日志。
        logger.warning("meal analysis failed type=%s", type(e).__name__)
        raise HTTPException(502, "照片分析失败，请重试或手动记录。") from e
    finally:
        active_users.discard(user_id)
