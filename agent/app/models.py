"""
Pydantic 请求/响应数据模型

前端 ↔ Python Agent 交互用的数据结构。
"""


from pydantic import BaseModel


class ChatRequest(BaseModel):
    """发起对话的请求体（GET 请求参数/query string）"""
    message: str                              # 用户输入的消息
    session_id: int | None = None          # 已有会话 ID（不传则创建新会话）


class SessionInfo(BaseModel):
    """会话基本信息"""
    id: int
    name: str
    created_at: str


class PagedSessions(BaseModel):
    """会话列表分页信封"""
    items: list[SessionInfo]
    total: int
    limit: int
    offset: int


class SessionDetail(BaseModel):
    """会话详情（含完整消息历史）"""
    id: int
    name: str
    user_id: int | None = None
    system_msg: str
    messages: list[dict]     # [{"role": "user", "content": "..."}, ...]
    created_at: str
    updated_at: str
