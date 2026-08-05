"""
会话状态管理 — 封装对话消息列表和持久化

每段对话对应一个 Conversation 实例：
  - 内存中持有消息列表，快速插入和回滚
  - 每次用户消息和 AI 回复后自动保存到 SQLite

消息格式（OpenAI 标准）：
  {"role": "system", "content": "你是..."}
  {"role": "user",   "content": "今天吃了什么"}
  {"role": "assistant", "content": "根据记录..."}
  {"role": "tool",   "content": "工具返回值", "tool_call_id": "call_xxx"}
"""

import json
from typing import Optional

from app import db
from app.config import settings


class Conversation:
    """一段对话的状态管理"""

    def __init__(
        self,
        session_id: int = 0,
        user_id: Optional[int] = None,
        system_msg: str = "",
    ):
        self.session_id = session_id          # 数据库会话 ID
        self.user_id = user_id                 # NutriGo 用户 ID
        self.system_msg = system_msg or settings.system_prompt
        self.messages: list[dict] = []         # 消息历史（不含 system 消息）
        self._dirty = False                    # 有未保存的变更

    def _build_system_msg(self) -> str:
        """组装系统提示词：追加当前用户 ID，让 LLM 调用 get_user_profile 等工具时知道传什么"""
        msg = self.system_msg
        if self.user_id:
            msg += f"\n\n当前对话的用户 ID 是 {self.user_id}。当需要调用 get_user_profile、get_diet_history 等工具时，直接使用该 ID 作为 user_id 参数，不要向用户索要 ID。"
        return msg

    # ================================================================
    # 消息操作
    # ================================================================

    def add_user_message(self, content: str) -> None:
        """追加一条用户消息"""
        self.messages.append({"role": "user", "content": content})
        self._dirty = True

    def add_assistant_message(self, content: str, thinking: str = "") -> None:
        """追加一条 AI 回复，thinking 为模型思维链（可选）"""
        msg: dict = {"role": "assistant", "content": content}
        if thinking:
            msg["thinking"] = thinking
        self.messages.append(msg)
        self._dirty = True

    def add_tool_result(self, tool_call_id: str, tool_name: str, result: str) -> None:
        """追加一条工具调用结果"""
        self.messages.append({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "content": result,
        })
        self._dirty = True

    def add_assistant_tool_calls(self, tool_calls: list[dict]) -> None:
        """
        追加一条包含 tool_calls 的 assistant 消息。
        这是 LLM 决定调用工具时产生的那条 assistant 消息。
        格式：[{"id": "call_xxx", "type": "function", "function": {"name": "x", "arguments": "{}"}}]
        """
        self.messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": tool_calls,
        })
        self._dirty = True

    def rollback_last_assistant(self) -> Optional[str]:
        """
        回滚最后一条 assistant 消息，返回被回滚的内容。
        用于处理 SSE 连接中断等异常情况。
        """
        if self.messages and self.messages[-1]["role"] == "assistant":
            removed = self.messages.pop()
            self._dirty = True
            return removed.get("content", "")
        return None

    def to_messages(self) -> list[dict]:
        """
        返回发给 LLM 的完整消息列表。
        system 消息放在最前面，后面跟对话历史。
        thinking 字段仅前端展示用，不发给 LLM，这里剔除。
        """
        msgs = []
        for m in self.messages:
            if "thinking" in m:
                m = {k: v for k, v in m.items() if k != "thinking"}
            msgs.append(m)
        return [{"role": "system", "content": self._build_system_msg()}] + msgs

    # ================================================================
    # 持久化
    # ================================================================

    @staticmethod
    async def create_new(user_id: Optional[int] = None) -> "Conversation":
        """创建新会话，在数据库中新建一条记录"""
        session_id = await db.create_session(user_id=user_id)
        conv = Conversation(session_id=session_id, user_id=user_id)
        await conv.save()
        return conv

    @staticmethod
    async def load(session_id: int, user_id: Optional[int] = None) -> Optional["Conversation"]:
        """从数据库加载已有会话。传入 user_id 时校验归属"""
        row = await db.get_session(session_id, user_id=user_id)
        if row is None:
            return None
        messages = json.loads(row["messages"])
        conv = Conversation(
            session_id=session_id,
            user_id=row.get("user_id"),
            system_msg=row["system_msg"],
        )
        conv.messages = messages
        conv._dirty = False
        return conv

    async def save(self) -> None:
        """将当前消息历史保存到数据库"""
        if self.session_id == 0:
            return
        await db.save_messages(self.session_id, self.messages)
        # 第一次保存时顺便更新会话名
        if self.messages:
            first_user = next(
                (m["content"] for m in self.messages if m["role"] == "user"), ""
            )
            if first_user:
                await db.update_session_name(self.session_id, first_user)
        self._dirty = False
