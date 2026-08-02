"""
NutriGo Go 后端 API 测试脚本
用法：先启动 Go 服务（go run ./cmd/server），然后运行本脚本
    python3 test_api.py
"""
import json
import urllib.request
import urllib.error
import sys
import uuid

BASE = "http://localhost:3333"
passed = 0
failed = 0

# 最小化的 1x1 透明 PNG 文件（87 字节），用于上传测试
MINI_PNG = bytes([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG 签名
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR 块
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
    0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,  # IDAT 块
    0x54, 0x78, 0x9C, 0x63, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  # IEND 块
    0x00, 0x00, 0x00, 0x0B, 0x49, 0x45, 0x4E, 0x44,
    0xAE, 0x42, 0x60, 0x82,
])


def request(method, path, body=None, headers=None):
    """发送 JSON 请求，返回 (status, body_dict)"""
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)

    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except urllib.error.URLError:
        print("\n❌ 无法连接服务器。请先启动 Go 服务：go run ./cmd/server")
        sys.exit(1)


def upload_file(path, file_bytes, filename, headers=None):
    """上传文件（multipart/form-data），返回 (status, body_dict)"""
    boundary = uuid.uuid4().hex
    body_lines = [
        f"--{boundary}",
        f'Content-Disposition: form-data; name="image"; filename="{filename}"',
        "Content-Type: application/octet-stream",
        "",
        ""
    ]
    body = ("\r\n".join(body_lines)).encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()

    hdrs = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if headers:
        hdrs.update(headers)

    req = urllib.request.Request(f"{BASE}{path}", data=body, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        resp_bytes = e.read()
        try:
            return e.code, json.loads(resp_bytes.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return e.code, {"error": resp_bytes.decode(errors="replace")[:200]}
    except urllib.error.URLError:
        print("\n❌ 无法连接服务器。请先启动 Go 服务：go run ./cmd/server")
        sys.exit(1)


def check(name, actual, expected):
    """断言检查"""
    global passed, failed
    ok = actual == expected
    status = "✅" if ok else "❌"
    print(f"  {status} {name}: 期望 {expected}, 实际 {actual}")
    if ok:
        passed += 1
    else:
        failed += 1
    return ok


# ============================================================
print("=" * 55)
print("NutriGo API 测试")
print("=" * 55)

# ---------- 1. 健康检查 ----------
print("\n📌 1. 健康检查")
status, body = request("GET", "/api/health")
check("状态码 200", status, 200)
check("status 字段", body.get("status"), "healthy")

# ---------- 2. 注册 ----------
print("\n📌 2. 用户注册")
status, body = request("POST", "/api/auth/register",
                       {"username": "tester", "password": "test123"})
check("正常注册 → 201", status, 201)
check("返回用户名", body.get("username"), "tester")

status, body = request("POST", "/api/auth/register",
                       {"username": "tester", "password": "test123"})
check("重复注册 → 409", status, 409)

status, body = request("POST", "/api/auth/register",
                       {"username": "ab", "password": "12"})
check("参数太短 → 400", status, 400)

# ---------- 3. 登录 ----------
print("\n📌 3. 用户登录")
status, body = request("POST", "/api/auth/login",
                       {"username": "tester", "password": "test123"})
check("正常登录 → 200", status, 200)
check("返回用户名", body.get("username"), "tester")
token = body.get("token", "")
check("返回 token", bool(token), True)

status, body = request("POST", "/api/auth/login",
                       {"username": "tester", "password": "wrong"})
check("错误密码 → 401", status, 401)

status, body = request("POST", "/api/auth/login",
                       {"username": "nobody", "password": "123456"})
check("不存在的用户 → 401", status, 401)

# ---------- 4. JWT 保护路由 ----------
print("\n📌 4. JWT 受保护路由")
auth = {"Authorization": f"Bearer {token}"}

status, body = request("GET", "/api/protected/example", headers=auth)
check("有效 token → 200", status, 200)
check("返回 user_id", body.get("user_id"), 1)

status, body = request("GET", "/api/protected/example")
check("无 token → 401", status, 401)

status, body = request("GET", "/api/protected/example",
                       headers={"Authorization": "Bearer fake-token"})
check("假 token → 401", status, 401)

# ---------- 5. 内部鉴权 ----------
print("\n📌 5. 内部服务鉴权")
internal = {"X-Internal-Token": "nutri-go-internal-token-dev"}

status, body = request("GET", "/api/internal/example", headers=internal)
check("正确内部 token → 200", status, 200)

status, body = request("GET", "/api/internal/example",
                       headers={"X-Internal-Token": "wrong"})
check("错误内部 token → 403", status, 403)

status, body = request("GET", "/api/internal/example")
check("无内部 token → 403", status, 403)

# ---------- 6. 健康档案 ----------
print("\n📌 6. 健康档案")

status, body = request("GET", "/api/users/1/profile", headers=auth)
check("未填写档案 → 200", status, 200)
check("height_cm 默认 0", body.get("height_cm"), 0)

profile_data = {
    "height_cm": 170, "weight_kg": 65, "age": 25,
    "gender": "male", "goal": "maintain",
    "allergies": ["peanut"], "dietary_habits": ["no_pork"]
}
status, body = request("PUT", "/api/users/1/profile", body=profile_data, headers=auth)
check("填写档案 → 200", status, 200)
check("身高 170", body.get("height_cm"), 170)

status, body = request("PUT", "/api/users/1/profile",
                       body={"height_cm": 175, "weight_kg": 68, "age": 26,
                             "gender": "male", "goal": "gain_muscle",
                             "allergies": [], "dietary_habits": []},
                       headers=auth)
check("更新档案 → 200", status, 200)
check("身高变为 175", body.get("height_cm"), 175)

status, body = request("GET", "/api/users/99/profile", headers=auth)
check("查看他人 → 403", status, 403)

status, body = request("GET", "/api/users/1/profile")
check("无 token 访问档案 → 401", status, 401)

# ---------- 7. 图片上传 ----------
print("\n📌 7. 图片上传")

# 7a. 正常上传
status, body = upload_file("/api/images/upload", MINI_PNG, "test.png", headers=auth)
check("上传 PNG → 201", status, 201)
image_id = body.get("id", 0)
check("返回 image_id", bool(image_id), True)
check("mime_type 为 image/png", body.get("mime_type"), "image/png")

# 7b. 无 token 上传
status, body = upload_file("/api/images/upload", MINI_PNG, "test.png")
check("无 token 上传 → 401", status, 401)

# 7c. 内部路由获取图片元信息
status, body = request("GET", f"/api/images/{image_id}", headers=internal)
check("内部获取 meta → 200", status, 200)
check("返回 user_id", body.get("user_id"), 1)

# 7d. 内部路由获取图片元信息，无效 ID
status, body = request("GET", "/api/images/99999", headers=internal)
check("获取不存在图片 → 404", status, 404)

# 7e. 无内部 token 访问
status, body = request("GET", f"/api/images/{image_id}")
check("无内部 token 获取 meta → 403", status, 403)

# 7f. 删除图片（JWT）
status, body = request("DELETE", f"/api/images/{image_id}", headers=auth)
check("删除图片 → 200", status, 200)

# 7g. 再次获取已删除的图片
status, body = request("GET", f"/api/images/{image_id}", headers=internal)
check("获取已删除图片 → 404", status, 404)

# 7h. 删除他人图片（再上传一张，用另一个用户删）
status, body = upload_file("/api/images/upload", MINI_PNG, "test.png", headers=auth)
image_id2 = body.get("id", 0)

# 注册并登录另一个用户
request("POST", "/api/auth/register", {"username": "other", "password": "pass1234"})
status2, body2 = request("POST", "/api/auth/login", {"username": "other", "password": "pass1234"})
other_auth = {"Authorization": f"Bearer {body2.get('token', '')}"}

status, body = request("DELETE", f"/api/images/{image_id2}", headers=other_auth)
check("删除他人图片 → 403", status, 403)

# 7i. 无 token 删除
status, body = request("DELETE", f"/api/images/{image_id2}")
check("无 token 删除 → 401", status, 401)

# ---------- 8. 饮食记录 ----------
print("\n📌 8. 饮食记录")

# 8a. 创建记录
today = "2026-08-01"
record_data = {
    "date": today,
    "meal_type": "lunch",
    "food_name": "宫保鸡丁",
    "portion": "1份",
    "calories": 450,
    "protein_g": 30,
    "fat_g": 22,
    "carbs_g": 35,
    "notes": "有点辣"
}
status, body = request("POST", "/api/diet/logs", body=record_data, headers=auth)
check("创建记录 → 201", status, 201)
record_id = body.get("id", 0)
check("返回 record_id", bool(record_id), True)
check("食物名 宫保鸡丁", body.get("food_name"), "宫保鸡丁")
check("热量 450", body.get("calories"), 450)

# 8b. 再创建一条（带 image_id）
status, body = request("POST", "/api/diet/logs", body={
    "date": today,
    "meal_type": "dinner",
    "food_name": "红烧肉",
    "portion": "200g",
    "calories": 600,
    "protein_g": 25,
    "fat_g": 45,
    "carbs_g": 15,
    "image_id": image_id2
}, headers=auth)
check("带 image_id 创建 → 201", status, 201)

# 8c. 按日期查询
status, body = request("GET", f"/api/diet/logs?date={today}", headers=auth)
check("查询当日记录 → 200", status, 200)
check("当天有 2 条", len(body), 2)
check("最新是红烧肉", body[0].get("food_name"), "红烧肉")

# 8d. 查询无记录的日期
status, body = request("GET", "/api/diet/logs?date=1970-01-01", headers=auth)
check("无记录日期返回空列表", body, [])

# 8e. 缺少 date 参数
status, body = request("GET", "/api/diet/logs", headers=auth)
check("缺少 date → 400", status, 400)

# 8f. 删除记录
status, body = request("DELETE", f"/api/diet/logs/{record_id}", headers=auth)
check("删除记录 → 200", status, 200)

# 8g. 验证只有 1 条了
status, body = request("GET", f"/api/diet/logs?date={today}", headers=auth)
check("删后剩 1 条", len(body), 1)

# 8h. 删除他人的记录（用 other 用户）
other_record_id = body[0].get("id", 0)
status, body = request("DELETE", f"/api/diet/logs/{other_record_id}", headers=other_auth)
check("删除他人记录 → 403", status, 403)

# 8i. 无 token
status, body = request("GET", f"/api/diet/logs?date={today}")
check("无 token 查看 → 401", status, 401)

# 8j. 创建时缺少必填字段
status, body = request("POST", "/api/diet/logs", body={"meal_type": "snack"}, headers=auth)
check("缺少 date/food_name → 400", status, 400)

# ---------- 9. 内部路由（Python Agent 用）----------
print("\n📌 9. 内部路由（健康档案 + 饮食记录）")

# 9a. 内部查档案
status, body = request("GET", "/api/internal/users/1/profile", headers=internal)
check("内部查档案 → 200", status, 200)
check("身高 175", body.get("height_cm"), 175)

# 9b. 内部查不存在的用户档案
status, body = request("GET", "/api/internal/users/999/profile", headers=internal)
check("内部查不存在用户 → 200 返回空值", body.get("height_cm"), 0)

# 9c. 内部查饮食记录
status, body = request("GET", f"/api/internal/diet/logs?user_id=1&date={today}", headers=internal)
check("内部查饮食 → 200", status, 200)
check("查到红烧肉", len(body), 1)
check("食物名 红烧肉", body[0].get("food_name"), "红烧肉")

# 9d. 内部查饮食缺少 user_id
status, body = request("GET", f"/api/internal/diet/logs?date={today}", headers=internal)
check("内部查饮食缺 user_id → 400", status, 400)

# 9e. 内部查其他用户的记录
status, body = request("GET", "/api/internal/diet/logs?user_id=2&date=2026-08-01", headers=internal)
check("内部查 other 的空记录 → 200", status, 200)
check("空列表", body, [])

# ============================================================
total = passed + failed
print(f"\n{'=' * 55}")
print(f"测试结果: {passed}/{total} 通过", end="")
if failed > 0:
    print(f", {failed} 失败")
else:
    print(" 🎉")

if failed > 0:
    sys.exit(1)
