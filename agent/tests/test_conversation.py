"""会话状态与上下文截断逻辑单元测试"""
from datetime import datetime

from app.config import settings
from app.conversation import Conversation


def build_turn(n: int) -> list[dict]:
    return [
        {"role": "user", "content": f"q{n}"},
        {"role": "assistant", "content": f"a{n}"},
    ]


# ---------------- 消息操作 ----------------

def test_add_messages():
    conv = Conversation()
    conv.add_user_message("hi")
    conv.add_assistant_message("hello", thinking="think")
    conv.add_tool_result("call_1", "lookup_food_nutrition", "米饭 116kcal")
    conv.add_assistant_tool_calls([
        {"id": "call_x", "type": "function", "function": {"name": "x", "arguments": "{}"}}
    ])
    assert len(conv.messages) == 4
    assert conv.messages[0]["role"] == "user"
    assert conv.messages[1]["thinking"] == "think"
    assert conv.messages[2]["tool_call_id"] == "call_1"
    assert conv.messages[3]["tool_calls"][0]["id"] == "call_x"


def test_rollback_last_assistant():
    conv = Conversation()
    conv.add_user_message("hi")
    conv.add_assistant_message("a1")
    conv.add_assistant_message("a2")
    assert conv.rollback_last_assistant() == "a2"
    assert len(conv.messages) == 2
    assert conv.rollback_last_assistant() == "a1"
    # 最后一条是 user，无可回滚
    assert conv.rollback_last_assistant() is None


def test_to_messages_strips_thinking_and_builds_system():
    conv = Conversation(user_id=5)
    conv.add_user_message("hi")
    conv.add_assistant_message("answer", thinking="内部思考")
    msgs = conv.to_messages()
    assert msgs[0]["role"] == "system"
    assert "服务端绑定当前登录用户" in msgs[0]["content"]
    assert all("thinking" not in m for m in msgs)


def test_system_date_refreshes_when_conversation_crosses_midnight(utc_clock):
    utc_clock.instant = datetime.fromisoformat("2026-09-16T15:59:59+00:00")
    conv = Conversation(user_id=5)
    conv.add_user_message("今天吃了什么")
    before = conv.to_messages()[0]["content"]
    utc_clock.instant = datetime.fromisoformat("2026-09-16T16:00:00+00:00")
    after = conv.to_messages()[0]["content"]
    assert "今天的日期是 2026-09-16" in before
    assert "今天的日期是 2026-09-17" in after
    assert "TODAY_DATE" not in after


async def test_loaded_legacy_prompt_refreshes_date_without_rewriting_history(db_path, utc_clock):
    from app import db

    await db.init_db()
    legacy = ('今天的日期是 2026-09-16，用户说"今天"即 2026-09-16。'
              '\n自定义说明：2026-09-15 的记录请保留。')
    sid = await db.create_session(system_msg=legacy, user_id=5)
    history = [{"role": "assistant", "content": "今天是 2026-09-16"}]
    await db.save_messages(sid, history)
    conv = await Conversation.load(sid, user_id=5)
    assert conv is not None
    messages = conv.to_messages()
    assert "今天的日期是 2026-09-17" in messages[0]["content"]
    assert '用户说"今天"即 2026-09-17' in messages[0]["content"]
    assert "2026-09-15 的记录请保留" in messages[0]["content"]
    assert messages[1:] == history


async def test_reloaded_default_conversation_uses_current_date(db_path, utc_clock):
    from app import db

    await db.init_db()
    utc_clock.instant = datetime.fromisoformat("2026-09-16T15:59:59+00:00")
    conv = await Conversation.create_new(user_id=5)
    conv.add_user_message("今天吃了什么")
    await conv.save()
    utc_clock.instant = datetime.fromisoformat("2026-09-16T16:00:00+00:00")
    loaded = await Conversation.load(conv.session_id, user_id=5)
    assert loaded is not None
    assert "今天的日期是 2026-09-17" in loaded.to_messages()[0]["content"]


# ---------------- 上下文截断 ----------------

def test_truncate_by_message_count_keeps_latest(monkeypatch):
    monkeypatch.setattr(settings, "MAX_CONTEXT_MESSAGES", 4)
    monkeypatch.setattr(settings, "MAX_CONTEXT_TOKENS", 100000)  # token 预算充足，只按条数裁
    conv = Conversation()
    conv.messages = [m for i in range(5) for m in build_turn(i)]  # 10 条
    out = conv._truncate_for_llm(conv.messages)
    assert len(out) <= 4
    assert out[-1]["content"] == "a4"  # 最新保留


def test_truncate_by_message_count_preserves_blocks(monkeypatch):
    monkeypatch.setattr(settings, "MAX_CONTEXT_MESSAGES", 4)
    monkeypatch.setattr(settings, "MAX_CONTEXT_TOKENS", 100000)
    conv = Conversation()
    conv.messages = [m for i in range(3) for m in build_turn(i)]  # 6 条
    out = conv._truncate_for_llm(conv.messages)
    # 以 user 为块整块丢弃：结果应是连续的最新块
    assert out[0]["role"] == "user"


def test_truncate_by_token_budget(monkeypatch, fake_litellm):
    monkeypatch.setattr(settings, "MAX_CONTEXT_MESSAGES", 0)  # 不限制条数
    monkeypatch.setattr(settings, "MAX_CONTEXT_TOKENS", 20)
    conv = Conversation()
    # 两个 user 回合：旧回合(q0/a0)超预算应被整体丢弃，新回合(q1/a1)保留
    conv.messages = [
        {"role": "user", "content": "q0" + "x" * 100},
        {"role": "assistant", "content": "a0" + "x" * 100},
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
    ]
    out = conv._truncate_for_llm(conv.messages)
    assert out == [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
    ]


def test_truncate_keeps_newest_block_even_over_budget(monkeypatch, fake_litellm):
    monkeypatch.setattr(settings, "MAX_CONTEXT_MESSAGES", 0)
    monkeypatch.setattr(settings, "MAX_CONTEXT_TOKENS", 1)
    conv = Conversation()
    # 整个对话只有一条 user->assistant 块，即使超预算也必须保留（不丢最新轮次）
    conv.messages = [
        {"role": "user", "content": "q" + "x" * 100},
        {"role": "assistant", "content": "a" + "x" * 100},
    ]
    out = conv._truncate_for_llm(conv.messages)
    assert len(out) == 2


def test_truncate_empty_returns_empty(monkeypatch):
    monkeypatch.setattr(settings, "MAX_CONTEXT_MESSAGES", 4)
    conv = Conversation()
    assert conv._truncate_for_llm([]) == []


def test_truncate_respects_full_budget(monkeypatch, fake_litellm):
    monkeypatch.setattr(settings, "MAX_CONTEXT_MESSAGES", 0)
    monkeypatch.setattr(settings, "MAX_CONTEXT_TOKENS", 1000)
    conv = Conversation()
    conv.messages = [{"role": "user", "content": "ok"}, {"role": "assistant", "content": "fine"}]
    out = conv._truncate_for_llm(conv.messages)
    assert len(out) == 2  # 预算充足，全保留
