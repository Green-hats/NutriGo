"""
JWT 校验 — 与 Go 后端签发的 token 兼容

Go 端 (internal/config/jwt.go) 使用 HS256 + golang-jwt/v5 签发：
  payload: {"user_id": <uint>, "username": <str>, "exp": ..., "iat": ...}

本模块用标准库 hmac/hashlib/base64 独立验签（HS256），
不依赖第三方 JWT 库。
"""

import base64
import hashlib
import hmac
import json
import time

import httpx
from fastapi import HTTPException

from app.config import settings
from recognition.go_client import go_client


def _b64decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _sign(message: bytes, secret: str) -> str:
    return _b64encode(hmac.new(secret.encode(), message, hashlib.sha256).digest())


def verify_token(token: str) -> dict | None:
    """
    校验 JWT：验签 + 过期检查，返回 payload（含 user_id）或 None。
    与 Go 的 jwt.ParseWithClaims(...) 行为对齐。
    """
    try:
        header_b64, payload_b64, signature = token.split(".")
    except ValueError:
        return None

    # 1. 验签
    message = f"{header_b64}.{payload_b64}".encode()
    expected = _sign(message, settings.JWT_SECRET)
    if not hmac.compare_digest(expected, signature):
        return None

    # 2. 解析 payload
    try:
        payload = json.loads(_b64decode(payload_b64))
    except (json.JSONDecodeError, ValueError):
        return None

    # 3. 过期检查
    exp = payload.get("exp")
    if exp is not None and float(exp) < time.time():
        return None

    # 4. 校验签名算法（防止 alg=none 之类攻击）
    try:
        header = json.loads(_b64decode(header_b64))
        if header.get("alg") != "HS256":
            return None
    except (json.JSONDecodeError, ValueError):
        return None

    return payload


def extract_user_id(authorization: str | None) -> int | None:
    """从 Authorization 头提取 user_id，无效返回 None"""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    payload = verify_token(parts[1].strip())
    if payload is None:
        return None
    user_id = payload.get("user_id")
    return int(user_id) if isinstance(user_id, (int, float)) else None


async def require_user_id(authorization: str | None) -> int:
    """先本地验签，再向 Go 查询吊销状态，所有受保护路由共用此入口。"""
    user_id = extract_user_id(authorization)
    if user_id is None or authorization is None:
        raise HTTPException(status_code=401, detail="未认证或 token 无效")
    try:
        result = await go_client.verify_access_token(authorization.split(" ", 1)[1].strip())
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise HTTPException(status_code=401, detail="登录已失效，请重新登录") from exc
        raise HTTPException(status_code=503, detail="暂时无法验证登录状态，请稍后重试") from exc
    except (httpx.RequestError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="暂时无法验证登录状态，请稍后重试") from exc
    if not isinstance(result, dict) or result.get("user_id") != user_id:
        raise HTTPException(status_code=503, detail="无法验证登录状态")
    return user_id
