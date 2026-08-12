"""会话持久化（SQLite CRUD）单元测试"""

import json

from app import db


async def test_create_and_get_session(db_path):
    await db.init_db()
    sid = await db.create_session(user_id=7)
    row = await db.get_session(sid, user_id=7)
    assert row is not None
    assert row["user_id"] == 7
    # 归属校验：其他用户不可见
    assert await db.get_session(sid, user_id=99) is None
    assert await db.get_session(999) is None


async def test_save_messages_and_list(db_path):
    await db.init_db()
    sid = await db.create_session(user_id=1)
    await db.save_messages(sid, [{"role": "user", "content": "你好"}])
    await db.create_session(user_id=2)

    items = await db.list_sessions(user_id=1)
    assert len(items) == 1
    row = await db.get_session(sid)
    assert json.loads(row["messages"]) == [{"role": "user", "content": "你好"}]


async def test_update_session_name_truncates(db_path):
    await db.init_db()
    sid = await db.create_session(user_id=1)
    long_name = "x" * 100
    ok = await db.update_session_name(sid, long_name, user_id=1)
    assert ok
    row = await db.get_session(sid)
    assert len(row["name"]) == 30
    # 越权改名失败
    assert not await db.update_session_name(sid, "hack", user_id=99)


async def test_rollback_last_exchange(db_path):
    await db.init_db()
    sid = await db.create_session(user_id=1)
    await db.save_messages(sid, [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
        {"role": "tool", "content": "r"},
    ])
    removed = await db.rollback_last_exchange(sid, user_id=1)
    assert removed == 2  # 回滚到 q2，删除其后的 assistant + tool
    row = await db.get_session(sid)
    msgs = json.loads(row["messages"])
    assert msgs == [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "q2"},
    ]


async def test_rollback_last_exchange_errors(db_path):
    await db.init_db()
    sid = await db.create_session(user_id=1)
    await db.save_messages(sid, [{"role": "assistant", "content": "no-user"}])
    assert await db.rollback_last_exchange(sid, user_id=1) == 0
    assert await db.rollback_last_exchange(999, user_id=1) == -1


async def test_delete_session(db_path):
    await db.init_db()
    sid = await db.create_session(user_id=1)
    assert await db.delete_session(sid, user_id=1)
    assert not await db.delete_session(sid, user_id=1)
    # 越权删除失败
    sid2 = await db.create_session(user_id=2)
    assert not await db.delete_session(sid2, user_id=1)
