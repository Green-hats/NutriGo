"""
Go 后端 HTTP 客户端 — 封装所有对 Go 服务的调用

Go 服务地址：config.GO_BACKEND_URL（默认 http://localhost:3333）
内部鉴权：config.INTERNAL_TOKEN 作为 X-Internal-Token 请求头

健壮性：
  - 共享 AsyncClient（连接池复用，不再每次调用新建）
  - 统一超时（连接 5s / 读写 30s）
  - 指数退避重试（网络错误与 502/503/504，最多 3 次）
"""

import asyncio
import random

import httpx

from app.config import settings

# 可重试的服务端状态码（网关/服务暂时不可用）
_RETRYABLE_STATUS = {502, 503, 504}
_MAX_ATTEMPTS = 3


def _backoff(attempt: int) -> float:
    """指数退避 + 抖动（0.5s * 2^n，封顶 4s）"""
    return min(0.5 * (2 ** attempt), 4.0) + random.uniform(0, 0.3)


class GoClient:
    """异步 HTTP 客户端，带内部鉴权"""

    def __init__(self) -> None:
        self.base = settings.GO_BACKEND_URL
        self.headers = {"X-Internal-Token": settings.INTERNAL_TOKEN}
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        """懒创建共享 client，复用连接池"""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base,
                timeout=httpx.Timeout(30.0, connect=5.0),
            )
        return self._client

    async def _request(self, method: str, path: str, *, params: dict | None = None) -> httpx.Response:
        client = self._get_client()
        url = f"{self.base}{path}"
        last_err: Exception | None = None

        for attempt in range(_MAX_ATTEMPTS):
            try:
                resp = await client.request(method, url, params=params, headers=self.headers)
                # 网关/服务暂时不可用 → 重试；其余错误直接抛出
                if resp.status_code in _RETRYABLE_STATUS:
                    raise httpx.HTTPStatusError(
                        f"HTTP {resp.status_code}",
                        request=resp.request, response=resp,
                    )
                resp.raise_for_status()
                return resp
            except httpx.TransportError as e:
                last_err = e
            except httpx.HTTPStatusError as e:
                if e.response is not None and e.response.status_code in _RETRYABLE_STATUS:
                    last_err = e
                else:
                    raise
            if attempt < _MAX_ATTEMPTS - 1:
                await asyncio.sleep(_backoff(attempt))

        raise last_err  # type: ignore[misc]

    async def get_image_data(self, image_id: int) -> bytes:
        """GET /api/images/:id/data → 图片二进制"""
        resp = await self._request("GET", f"/api/images/{image_id}/data")
        return resp.content

    async def get_user_profile(self, user_id: int) -> dict:
        """GET /api/internal/users/:id/profile → 用户档案"""
        resp = await self._request("GET", f"/api/internal/users/{user_id}/profile")
        return resp.json()

    async def get_diet_logs(self, user_id: int, date: str) -> list[dict]:
        """GET /api/internal/diet/logs?user_id=&date= → 饮食记录"""
        resp = await self._request(
            "GET", "/api/internal/diet/logs",
            params={"user_id": user_id, "date": date},
        )
        return resp.json()

    async def get_diet_summaries(self, user_id: int, start: str, end: str) -> list[dict]:
        """GET /api/internal/diet/summaries?user_id=&start=&end= → 每日营养汇总"""
        resp = await self._request(
            "GET", "/api/internal/diet/summaries",
            params={"user_id": user_id, "start": start, "end": end},
        )
        return resp.json()

    async def aclose(self) -> None:
        """关闭共享连接（服务关闭时调用）"""
        if self._client is not None:
            await self._client.aclose()
            self._client = None


# 全局单例
go_client = GoClient()
