"""
Go 后端 HTTP 客户端 — 封装所有对 Go 服务的调用

Go 服务地址：config.GO_BACKEND_URL（默认 http://localhost:3333）
内部鉴权：config.INTERNAL_TOKEN 作为 X-Internal-Token 请求头
"""

import httpx

from app.config import settings


class GoClient:
    """异步 HTTP 客户端，带内部鉴权"""

    def __init__(self) -> None:
        self.base = settings.GO_BACKEND_URL
        self.headers = {"X-Internal-Token": settings.INTERNAL_TOKEN}

    async def get_image_data(self, image_id: int) -> bytes:
        """GET /api/images/:id/data → 图片二进制"""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base}/api/images/{image_id}/data",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.content

    async def get_user_profile(self, user_id: int) -> dict:
        """GET /api/internal/users/:id/profile → 用户档案"""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base}/api/internal/users/{user_id}/profile",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_diet_logs(self, user_id: int, date: str) -> list[dict]:
        """GET /api/internal/diet/logs?user_id=&date= → 饮食记录"""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base}/api/internal/diet/logs",
                params={"user_id": user_id, "date": date},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_diet_summaries(self, user_id: int, start: str, end: str) -> list[dict]:
        """GET /api/internal/diet/summaries?user_id=&start=&end= → 每日营养汇总"""
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base}/api/internal/diet/summaries",
                params={"user_id": user_id, "start": start, "end": end},
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()


# 全局单例
go_client = GoClient()
