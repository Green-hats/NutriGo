"""
NutriGo 图片识别测试 — 覆盖 /api/identify-food 的鉴权与功能

用法：先启动 Go(:3333) 和 Agent(:8000)，再运行
    cd agent && uv run python tests/integration/test_identify.py
"""
import asyncio
import base64
import hashlib
import hmac
import io
import json
import sys
import time

import httpx

AGENT = "http://localhost:8000"
GO = "http://localhost:3333"
JWT_SECRET = "nutri-go-secret-key-change-in-production"

passed = 0
failed = 0
failures = []


def make_token(user_id: int = 2, username: str = "xiaoming") -> str:
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


def check(name: str, ok: bool, detail: str = ""):
    global passed, failed
    mark = "✅" if ok else "❌"
    print(f"  {mark} {name}" + (f"  [{detail}]" if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1
        failures.append(f"{name} {detail}")


async def main():
    # 确认两个服务可用
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{AGENT}/api/sessions", headers={"Authorization": f"Bearer {make_token()}"}, timeout=5)
            if r.status_code not in (200, 401):
                print("❌ Agent 服务异常"); sys.exit(1)
        except Exception:
            print("❌ Agent 服务不可用，请先启动 :8000"); sys.exit(1)
        try:
            r = await client.get(f"{GO}/api/health", timeout=5)
            if r.status_code != 200:
                print("❌ Go 服务异常"); sys.exit(1)
        except Exception:
            print("❌ Go 服务不可用，请先启动 :3333"); sys.exit(1)

        token = make_token()
        auth = {"Authorization": f"Bearer {token}"}
        print("═══ 图片识别测试 ═══")

        # ---- 1. 鉴权 ----
        print("\n📌 1. 鉴权")
        r = await client.post(f"{AGENT}/api/identify-food", json={"image_id": 1})
        check("无 token → 401", r.status_code == 401, f"got {r.status_code}")

        r = await client.post(f"{AGENT}/api/identify-food", json={"image_id": 1}, headers={"Authorization": "Bearer bad.token"})
        check("坏 token → 401", r.status_code == 401, f"got {r.status_code}")

        # ---- 2. 上传一张测试图到 Go ----
        print("\n📌 2. 上传测试图片")
        # 生成一张纯色 PNG
        try:
            from PIL import Image
            buf = io.BytesIO()
            Image.new("RGB", (64, 64), (220, 120, 60)).save(buf, format="PNG")
            png_bytes = buf.getvalue()
        except ImportError:
            # PIL 不可用时用最小 PNG
            png_bytes = bytes([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
                0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
                0x54, 0x78, 0x9C, 0x63, 0x00, 0x00, 0x00, 0x02,
                0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x0B, 0x49, 0x45, 0x4E, 0x44,
                0xAE, 0x42, 0x60, 0x82,
            ])

        files = {"image": ("test.png", png_bytes, "image/png")}
        r = await client.post(f"{GO}/api/images/upload", files=files, headers=auth)
        check("上传图片 → 201", r.status_code == 201, f"got {r.status_code}")
        if r.status_code != 201:
            print("  无法继续（上传失败），跳过识别功能测试")
            _final()
            return
        image_id = r.json().get("id")
        check("返回 image_id", image_id is not None, f"id={image_id}")

        # ---- 3. 识别功能 ----
        print("\n📌 3. 识别功能")
        r = await client.post(f"{AGENT}/api/identify-food", json={"image_id": image_id}, headers=auth, timeout=120)
        check("识别 → 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            results = r.json()
            check("返回 Top-5 候选", isinstance(results, list) and len(results) == 5, f"len={len(results) if isinstance(results, list) else '?'}")
            if results:
                first = results[0]
                check("含 name 字段", bool(first.get("name")))
                check("含 confidence 字段", "confidence" in first)
                check("含 nutrition_per_100g", isinstance(first.get("nutrition_per_100g"), dict))
                check("含 default_portion", isinstance(first.get("default_portion"), dict))
                check("confidence 在 [0,1]", 0 <= first.get("confidence", -1) <= 1, f"conf={first.get('confidence')}")

        # ---- 4. 不存在图片 ----
        print("\n📌 4. 边界：不存在图片")
        r = await client.post(f"{AGENT}/api/identify-food", json={"image_id": 999999}, headers=auth)
        check("不存在图片 → 400", r.status_code == 400, f"got {r.status_code}")

        # ---- 5. 清理上传的测试图 ----
        print("\n📌 5. 清理")
        r = await client.delete(f"{GO}/api/images/{image_id}", headers=auth)
        check("删除测试图 → 200", r.status_code == 200, f"got {r.status_code}")

    _final()


def _final():
    global passed, failed
    print(f"\n{'=' * 50}")
    print(f"测试结果: {passed}/{passed + failed} 通过")
    if failed > 0:
        print("失败项:")
        for f in failures:
            print(f"  ❌ {f}")
        sys.exit(1)
    print("全部通过 🎉")


if __name__ == "__main__":
    asyncio.run(main())
