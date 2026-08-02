"""
NutriGo Agent 基础功能测试（不需要 LLM API Key）

用法：先启动 Go 服务，再运行本脚本
    cd agent && uv run python test_agent.py
"""

import asyncio
import subprocess
import sys
import time

import httpx

BASE = "http://localhost:8000"
passed = 0
failed = 0


def check(name, actual, expected):
    global passed, failed
    ok = actual == expected
    print(f"  {'✅' if ok else '❌'} {name}: 期望 {expected}, 实际 {actual}")
    if ok:
        passed += 1
    else:
        failed += 1


async def main():
    global passed, failed

    print("=" * 50)
    print("NutriGo Agent 基础测试")
    print("=" * 50)

    # ---- 启动服务 ----
    print("\n📌 启动 Agent 服务...")
    proc = subprocess.Popen(
        ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(3)

    try:
        async with httpx.AsyncClient() as client:
            # ---- 1. 服务启动 ----
            print("\n📌 1. 服务状态")
            try:
                resp = await client.get(f"{BASE}/api/sessions")
                check("服务可访问", resp.status_code, 200)
            except httpx.ConnectError:
                print("  ❌ 无法连接 Agent 服务")
                sys.exit(1)

            # ---- 2. 会话列表为空 ----
            resp = await client.get(f"{BASE}/api/sessions")
            sessions = resp.json()
            check("初始会话为空", len(sessions), 0)

            # ---- 3. 创建会话（模拟前端调用 chat 接口但不带 API Key）----
            # 这会触发 Agent Loop，但因为没 API Key 会返回 error 事件
            # SSE 连接会得到一些事件然后断开
            print("\n📌 2. SSE 对话（basic）")
            resp = await client.get(
                f"{BASE}/api/chat",
                params={"message": "你好"},
                timeout=15.0,
            )
            check("SSE 连接成功", resp.status_code, 200)
            body = resp.text
            check("响应非空", len(body) > 0, True)
            check("包含 error 事件（无API Key预期行为）", "error" in body, True)
            print(f"  📝 SSE 响应内容: {body[:200]}")

            # ---- 4. 会话列表有了一条 ----
            print("\n📌 3. 会话持久化")
            resp = await client.get(f"{BASE}/api/sessions")
            sessions = resp.json()
            check("会话已保存", len(sessions), 1)
            session_id = sessions[0]["id"]

            # ---- 5. 会话详情 ----
            resp = await client.get(f"{BASE}/api/sessions/{session_id}")
            detail = resp.json()
            check("获取会话详情", resp.status_code, 200)
            check("包含用户消息", len(detail["messages"]), 1)
            check("用户消息内容是 你好", detail["messages"][0]["content"], "你好")

            # ---- 6. 删除会话 ----
            print("\n📌 4. 删除会话")
            resp = await client.delete(f"{BASE}/api/sessions/{session_id}")
            check("删除成功", resp.status_code, 200)

            resp = await client.get(f"{BASE}/api/sessions")
            check("删除后为空", len(resp.json()), 0)

            # ---- 7. 不存在的会话 ----
            resp = await client.get(f"{BASE}/api/sessions/999")
            check("不存在的会话返回 404", resp.status_code, 404)

    finally:
        proc.terminate()
        proc.wait()

    # ---- 结果 ----
    total = passed + failed
    print(f"\n{'=' * 50}")
    print(f"测试结果: {passed}/{total} 通过", end="")
    if failed > 0:
        print(f", {failed} 失败")
    else:
        print(" 🎉")


if __name__ == "__main__":
    asyncio.run(main())
