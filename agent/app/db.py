"""
异步 SQLite 数据库操作 — 管理对话会话的持久化

sessions 表结构：
  id          INTEGER PRIMARY KEY
  name        TEXT     会话名称（取第一条用户消息截断）
  system_msg  TEXT     系统提示词
  messages    TEXT     完整消息历史（JSON 数组）
  user_id     INTEGER  NutriGo 用户 ID（可选，未来关联 Go 后端）
  created_at  TEXT     创建时间
  updated_at  TEXT     最后更新时间
"""

import json
from datetime import datetime
from typing import Optional

import aiosqlite

from app.config import settings


async def init_db() -> None:
    """初始化数据库：创建 sessions 表（如果不存在）"""
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL DEFAULT '',
                system_msg  TEXT NOT NULL DEFAULT '',
                messages    TEXT NOT NULL DEFAULT '[]',
                user_id     INTEGER,
                created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )
        """)
        await db.commit()


async def create_session(
    name: str = "",
    system_msg: str = "",
    user_id: Optional[int] = None,
) -> int:
    """创建新会话，返回 session_id"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO sessions (name, system_msg, user_id, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, system_msg, user_id, now, now),
        )
        await db.commit()
        return cursor.lastrowid


async def get_session(session_id: int, user_id: Optional[int] = None) -> Optional[dict]:
    """根据 ID 查询会话，返回 dict 或 None。传入 user_id 时校验归属"""
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row  # 让结果可以用列名访问
        if user_id is not None:
            cursor = await db.execute(
                "SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            )
        else:
            cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cursor.fetchone()
        if row is None:
            return None
        return dict(row)


async def save_messages(session_id: int, messages: list[dict]) -> None:
    """更新会话的消息历史和时间戳"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    messages_json = json.dumps(messages, ensure_ascii=False)
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        await db.execute(
            "UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?",
            (messages_json, now, session_id),
        )
        await db.commit()


async def update_session_name(session_id: int, name: str, user_id: Optional[int] = None) -> bool:
    """更新会话名称。传入 user_id 时校验归属，返回是否成功"""
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        if user_id is not None:
            cursor = await db.execute(
                "UPDATE sessions SET name = ? WHERE id = ? AND user_id = ?",
                (name[:30], session_id, user_id),
            )
        else:
            cursor = await db.execute(
                "UPDATE sessions SET name = ? WHERE id = ?",
                (name[:30], session_id),
            )
        await db.commit()
        return cursor.rowcount > 0


async def rollback_last_exchange(session_id: int, user_id: Optional[int] = None) -> int:
    """
    回滚到最后一条 user 消息之后（删除其后的 assistant/tool 消息）。
    用于"重新生成"：回到最后一次提问的状态。返回被删除的消息条数。
    """
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        if user_id is not None:
            cursor = await db.execute(
                "SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            )
        else:
            cursor = await db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = await cursor.fetchone()
        if row is None:
            return -1  # 会话不存在或无权访问

        messages = json.loads(row["messages"])
        if not messages:
            return 0

        # 找到最后一条 user 的下标
        last_user_idx = -1
        for i, m in enumerate(messages):
            if m.get("role") == "user":
                last_user_idx = i
        if last_user_idx == -1:
            return 0  # 没有 user 消息，无可回滚

        removed = len(messages) - (last_user_idx + 1)
        messages = messages[: last_user_idx + 1]
        await db.execute(
            "UPDATE sessions SET messages = ? WHERE id = ?",
            (json.dumps(messages, ensure_ascii=False), session_id),
        )
        await db.commit()
        return removed


async def list_sessions(limit: int = 20, user_id: Optional[int] = None) -> list[dict]:
    """列出最近的会话列表，可按 user_id 过滤"""
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        if user_id is not None:
            cursor = await db.execute(
                "SELECT id, name, created_at FROM sessions WHERE user_id = ? "
                "ORDER BY updated_at DESC LIMIT ?",
                (user_id, limit),
            )
        else:
            cursor = await db.execute(
                "SELECT id, name, created_at FROM sessions ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            )
        return [dict(row) for row in await cursor.fetchall()]


async def delete_session(session_id: int, user_id: Optional[int] = None) -> bool:
    """删除会话，返回是否成功。传入 user_id 时校验归属"""
    async with aiosqlite.connect(settings.DATABASE_PATH) as db:
        if user_id is not None:
            cursor = await db.execute(
                "DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
            )
        else:
            cursor = await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await db.commit()
        return cursor.rowcount > 0
