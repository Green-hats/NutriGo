"""
NutriGo Agent 基础功能测试（不需要 LLM API Key）

用法：先启动 Go 服务，再运行本脚本
    cd agent && uv run python tests/integration/test_agent.py
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time

import httpx

# 切到项目 agent 目录，保证能 import app 包、找到 agent.db
_THIS = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))  # <root>/agent/tests/integration
AGENT_DIR = os.path.dirname(os.path.dirname(_THIS))                    # <root>/agent
os.chdir(AGENT_DIR)

BASE = "http://localhost:8000"
passed = 0
failed = 0

# 与 Go 后端一致的 JWT 密钥
JWT_SECRET = "nutri-go-secret-key-change-in-production"


def make_token(user_id: int = 1, username: str = "test") -> str:
    """生成本地测试用的 HS256 JWT"""
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({
        "user_id": user_id,
        "username": username,
        "exp": int(time.time()) + 86400,
        "iat": int(time.time()),
    }).encode())
    msg = f"{header}.{payload}"
    sig = b64(hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest())
    return f"{msg}.{sig}"


def auth_headers(user_id: int = 1) -> dict:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


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
    time.sleep(30)  # torch + RAG 模型首次加载较慢

    try:
        async with httpx.AsyncClient() as client:
            # ---- 1. 服务启动 ----
            print("\n📌 1. 服务状态")
            try:
                resp = await client.get(f"{BASE}/api/sessions", headers=auth_headers())
                check("服务可访问", resp.status_code, 200)
            except httpx.ConnectError:
                print("  ❌ 无法连接 Agent 服务")
                sys.exit(1)

            # ---- 1.5 未认证访问被拒绝 ----
            print("\n📌 1.5 JWT 鉴权")
            resp = await client.get(f"{BASE}/api/sessions")
            check("无 token 返回 401", resp.status_code, 401)
            resp = await client.get(f"{BASE}/api/sessions", headers={"Authorization": "Bearer bad.token.here"})
            check("坏 token 返回 401", resp.status_code, 401)

            # ---- 2. 会话列表为空（分页信封）----
            resp = await client.get(f"{BASE}/api/sessions", headers=auth_headers())
            body = resp.json()
            check("分页信封存在", "items" in body, True)
            sessions = body["items"]
            check("初始会话为空", len(sessions), 0)
            check("total=0", body["total"], 0)

            # ---- 3. 创建会话（模拟前端调用 chat 接口但不带 API Key）----
            # 这会触发 Agent Loop，但因为没 API Key 会返回 error 事件
            # SSE 连接会得到一些事件然后断开
            print("\n📌 2. SSE 对话（basic）")
            resp = await client.get(
                f"{BASE}/api/chat",
                params={"message": "你好"},
                headers=auth_headers(),
                timeout=15.0,
            )
            check("SSE 连接成功", resp.status_code, 200)
            body = resp.text
            check("响应非空", len(body) > 0, True)
            check("SSE 返回数据", "data:" in body, True)
            print(f"  📝 SSE 响应内容: {body[:200]}")

            # ---- 4. 会话列表有了一条 ----
            print("\n📌 3. 会话持久化")
            resp = await client.get(f"{BASE}/api/sessions", headers=auth_headers())
            sessions = resp.json()["items"]
            check("会话已保存", len(sessions), 1)
            session_id = sessions[0]["id"]

            # ---- 5. 会话详情 ----
            resp = await client.get(f"{BASE}/api/sessions/{session_id}", headers=auth_headers())
            detail = resp.json()
            check("获取会话详情", resp.status_code, 200)
            check("包含用户消息", detail["messages"][0]["role"] == "user", True)
            check("用户消息内容是 你好", detail["messages"][0]["content"], "你好")

            # ---- 6. 删除会话 ----
            print("\n📌 4. 删除会话")
            resp = await client.delete(f"{BASE}/api/sessions/{session_id}", headers=auth_headers())
            check("删除成功", resp.status_code, 200)

            resp = await client.get(f"{BASE}/api/sessions", headers=auth_headers())
            check("删除后为空", len(resp.json()["items"]), 0)

            # ---- 7. 不存在的会话 ----
            resp = await client.get(f"{BASE}/api/sessions/999", headers=auth_headers())
            check("不存在的会话返回 404", resp.status_code, 404)

            # ---- 5. 营养计算端点 ----
            print("\n📌 5. 营养计算端点")
            resp = await client.post(
                f"{BASE}/api/calculate-intake",
                json={"food_name": "苹果", "grams": 200},
            )
            check("calculate-intake 无 token → 401", resp.status_code, 401)

            resp = await client.post(
                f"{BASE}/api/calculate-intake",
                headers=auth_headers(),
                json={"food_name": "苹果", "grams": 200},
            )
            body = resp.json()
            check("calculate-intake → 200", resp.status_code, 200)
            check("苹果200g热量≈108", abs(body["calories"] - 108.0) < 0.01, True)
            check("per_100g存在", "per_100g" in body, True)

            resp = await client.post(
                f"{BASE}/api/calculate-intake",
                headers=auth_headers(),
                json={"food_name": "不存在", "grams": 100},
            )
            check("不存在的菜 → 404", resp.status_code, 404)

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
