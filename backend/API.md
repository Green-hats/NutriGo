# NutriGo Go 后端 API 文档

> 服务端口：**3333** | 所有响应格式均为 JSON

---

## 目录

- [1. 健康检查](#1-健康检查)
- [2. 用户认证](#2-用户认证)
  - [2.1 注册](#21-注册)
  - [2.2 登录](#22-登录)
  - [2.3 JWT 使用说明](#23-jwt-使用说明)
- [3. 健康档案](#3-健康档案)
  - [3.1 查看档案](#31-查看档案)
  - [3.2 更新档案](#32-更新档案)
- [4. 图片管理](#4-图片管理)
  - [4.1 上传图片](#41-上传图片)
  - [4.2 删除图片](#42-删除图片)
  - [4.3 获取元信息（内部）](#43-获取元信息内部)
  - [4.4 获取二进制（内部）](#44-获取二进制内部)
- [5. 饮食记录](#5-饮食记录)
  - [5.1 创建记录](#51-创建记录)
  - [5.2 按日期查询](#52-按日期查询)
  - [5.3 删除记录](#53-删除记录)
- [6. 每日汇总](#6-每日汇总)
- [7. 开发调试接口](#7-开发调试接口)
- [附录 A：HTTP 状态码速查](#附录-ahttp-状态码速查)
- [附录 B：curl 全流程测试](#附录-bcurl-全流程测试)

---

## 1. 健康检查

```
GET /api/health
```

| 认证 | 无 |
|------|-----|

**`200 OK`**

```json
{ "status": "healthy" }
```

```bash
curl http://localhost:3333/api/health
```

---

## 2. 用户认证

### 2.1 注册

```
POST /api/auth/register
```

| 认证 | 无 |
|------|-----|

**请求体**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `username` | string | 是 | 3~32 字符，全局唯一 |
| `password` | string | 是 | 6~128 字符（服务端 bcrypt 加密） |

**`201 Created`**

```json
{ "id": 1, "username": "zhangsan" }
```

**`400`** — 参数格式不满足约束

```json
{ "error": "参数无效: Key: 'Username' Error:Field validation for 'Username' failed on the 'min' tag" }
```

**`409`** — 用户名已被注册

```json
{ "error": "用户名已存在" }
```

**`500`** — 服务端异常

```json
{ "error": "密码加密失败" }
```

```bash
curl -X POST http://localhost:3333/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"zhangsan","password":"123456"}'
```

---

### 2.2 登录

```
POST /api/auth/login
```

| 认证 | 无 |
|------|-----|

**请求体**

| 字段 | 类型 | 必填 |
|------|------|------|
| `username` | string | 是 |
| `password` | string | 是 |

**`200 OK`**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "YISu8n24V6VmiJLZyaXr1kvCvae2XK0lfxXa1ufXKe4",
  "expires_in": 7200,
  "id": 1,
  "username": "zhangsan"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `token` | string | 访问令牌（JWT），有效期 `expires_in` 秒（默认 2 小时） |
| `refresh_token` | string | 刷新令牌（不透明，14 天有效，仅存哈希于服务端） |
| `expires_in` | number | 访问令牌剩余有效秒数 |
| `id` | number | 用户 ID |
| `username` | string | 用户名 |

**`401`** — 用户名不存在或密码错误（始终返回相同提示，防用户枚举）

```json
{ "error": "用户名或密码错误" }
```

```bash
curl -X POST http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"zhangsan","password":"123456"}'
```

---

### 2.3 刷新令牌

```
POST /api/auth/refresh
```

**请求体**

| 字段 | 类型 | 必填 |
|------|------|------|
| `refresh_token` | string | 是 |

成功时返回与登录相同的响应（新的 `token` + `refresh_token`）。**轮换机制**：每次刷新都会吊销旧刷新令牌，防止重放；旧令牌再次使用返回 `401`。

```bash
curl -X POST http://localhost:3333/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"YISu8n24V6VmiJLZyaXr1kvCvae2XK0lfxXa1ufXKe4"}'
```

---

### 2.4 登出（吊销令牌）

```
POST /api/auth/logout
```

需 **JWT** 认证。将当前访问令牌的 `jti` 加入黑名单使其立即失效；请求体可附带 `refresh_token` 一并吊销。

**请求体（可选）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `refresh_token` | string | 需要吊销的刷新令牌 |

```bash
curl -X POST http://localhost:3333/api/auth/logout \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"YISu8n24V6VmiJLZyaXr1kvCvae2XK0lfxXa1ufXKe4"}'
```

---

### 2.5 JWT 使用说明

所有标注 **JWT** 认证的接口，需在请求头携带：

```
Authorization: Bearer <从登录接口拿到的 token>
```

- 算法：HS256
- 有效期：2 小时（短时访问令牌，过期后由前端用 refresh_token 自动换取）
- 内容：`{ "user_id": 1, "username": "zhangsan", "jti": "...", "exp": ..., "iat": ... }`
- `jti` 为令牌唯一 ID，登出后进入黑名单立即失效

> 任何人可解码 payload 查看内容，但签名防篡改。**Payload 中不放敏感信息（密码、手机号等）**。

---

## 3. 健康档案

> 所有档案接口只能操作 **JWT 中的用户 ID 匹配路由参数 `:id`** 的档案。越权访问返回 403。

### 3.1 查看档案

```
GET /api/users/:id/profile
```

| 认证 | JWT |
|------|-----|

**未填写过档案** `200 OK`

```json
{
  "height_cm": 0, "weight_kg": 0, "age": 0,
  "gender": "", "goal": "",
  "allergies": [], "dietary_habits": [], "chronic_diseases": []
}
```

**已填写** `200 OK`

```json
{
  "id": 1, "user_id": 1,
  "height_cm": 170, "weight_kg": 65, "age": 25,
  "gender": "male", "goal": "maintain",
  "allergies": ["peanut", "milk"],
  "dietary_habits": ["no_pork"],
  "chronic_diseases": ["hypertension", "diabetes"]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `height_cm` | float | 身高（厘米） |
| `weight_kg` | float | 体重（公斤） |
| `age` | int | 年龄 |
| `gender` | string | `male` / `female` / `other` |
| `goal` | string | `lose_weight` / `maintain` / `gain_muscle` |
| `allergies` | string[] | 过敏原 |
| `dietary_habits` | string[] | 饮食偏好 |
| `chronic_diseases` | string[] | 基础病（多选） |

---

### 3.2 更新档案

```
PUT /api/users/:id/profile
```

| 认证 | JWT |
|------|-----|
| 行为 | 不存在则创建，存在则更新 |

**请求体**（所有字段可选，未提供的字段重置为零值）

```json
{
  "height_cm": 170, "weight_kg": 65, "age": 25,
  "gender": "male", "goal": "maintain",
  "allergies": ["peanut", "milk"],
  "dietary_habits": ["no_pork"],
  "chronic_diseases": ["hypertension"]
}
```

**`200 OK`** — 返回更新后的完整档案

**`403`** — 无权修改他人档案

```bash
# 查看
curl http://localhost:3333/api/users/1/profile -H "Authorization: Bearer TOKEN"

# 更新
curl -X PUT http://localhost:3333/api/users/1/profile \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"height_cm":170,"weight_kg":65,"age":25,"gender":"male","goal":"maintain","allergies":["peanut"],"dietary_habits":["no_pork"],"chronic_diseases":["hypertension","diabetes"]}'
```

---

## 4. 图片管理

> 流程：前端上传图片到 Go → Python 通过内部接口获取图片二进制做 AI 识别 → 识别结果写入饮食记录 → 用户/前端可主动删除图片以释放磁盘空间。

### 4.1 上传图片

```
POST /api/images/upload
```

| 认证 | JWT |
|------|-----|
| Content-Type | `multipart/form-data` |
| 字段名 | `image` |

**安全限制**：仅允许 jpg/png/webp，最大 10MB。文件名自动 UUID 化。

**`201 Created`**

```json
{
  "id": 42,
  "filename": "d9560af6-01dc-4427-b542-e4eeea74ab27.png",
  "mime_type": "image/png",
  "size": 68
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 图片 ID，后续饮食记录可用 `image_id` 关联 |
| `filename` | string | UUID 重命名后的文件名 |
| `mime_type` | string | 检测到的真实 MIME 类型 |
| `size` | int | 文件字节数 |

**`400`** — 非图片格式或超过 10MB

```json
{ "error": "只支持 jpg/png/webp 格式" }
```

```bash
curl -X POST http://localhost:3333/api/images/upload \
  -H "Authorization: Bearer TOKEN" \
  -F "image=@food.jpg"
```

---

### 4.2 删除图片

```
DELETE /api/images/:id
```

| 认证 | JWT |
|------|-----|

同时删除磁盘文件和数据库记录。只能删除自己的图片。

**`200 OK`**

```json
{ "message": "删除成功" }
```

**`403`** — 无权删除他人图片

**`404`** — 图片不存在或已被删除

```bash
curl -X DELETE http://localhost:3333/api/images/42 \
  -H "Authorization: Bearer TOKEN"
```

---

### 4.3 获取元信息（内部）

```
GET /api/images/:id
```

| 认证 | Internal（`X-Internal-Token`） |
|------|-----|

供 Python Agent 获取图片元信息。

**`200 OK`**

```json
{
  "id": 42, "user_id": 1,
  "filename": "xxx.png", "mime_type": "image/png", "size": 68000
}
```

---

### 4.4 获取二进制（内部）

```
GET /api/images/:id/data
```

| 认证 | Internal |
|------|-----|

供 Python Agent 获取图片原始数据，响应的 `Content-Type` 为图片的 MIME 类型。

**`200 OK`** — 返回图片二进制流

**`404`** — 图片不存在或文件已丢失

```bash
curl http://localhost:3333/api/images/42/data \
  -H "X-Internal-Token: nutri-go-internal-token-dev" \
  -o food.png
```

---

## 5. 饮食记录

### 5.1 创建记录

```
POST /api/diet/logs
```

| 认证 | JWT |
|------|-----|

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `date` | string | 是 | 日期，格式 `YYYY-MM-DD` |
| `food_name` | string | 是 | 食物名称 |
| `meal_type` | string | 否 | `breakfast` / `lunch` / `dinner` / `snack` |
| `portion` | string | 否 | 份量，如 `"200g"`、`"1碗"` |
| `calories` | float | 否 | 热量（千卡） |
| `protein_g` | float | 否 | 蛋白质（克） |
| `fat_g` | float | 否 | 脂肪（克） |
| `carbs_g` | float | 否 | 碳水化合物（克） |
| `notes` | string | 否 | 备注 |
| `image_id` | int | 否 | 关联的食物图片 ID（可为 null） |

**`201 Created`**

```json
{
  "id": 1, "user_id": 1,
  "date": "2026-08-01", "meal_type": "lunch",
  "food_name": "宫保鸡丁", "portion": "1份",
  "calories": 450, "protein_g": 30, "fat_g": 22, "carbs_g": 35,
  "notes": "有点辣", "image_id": null,
  "created_at": "2026-08-01T12:00:00Z"
}
```

```bash
curl -X POST http://localhost:3333/api/diet/logs \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-01","meal_type":"lunch","food_name":"宫保鸡丁","portion":"1份","calories":450,"protein_g":30,"fat_g":22,"carbs_g":35,"notes":"有点辣"}'
```

---

### 5.2 按日期查询

```
GET /api/diet/logs?date=2026-08-01
```

| 认证 | JWT |
|------|-----|
| 参数 | `date`（必填，格式 `YYYY-MM-DD`） |

按创建时间倒序排列（最新的在前）。只返回当前用户的记录。

**`200 OK`**

```json
[
  {
    "id": 2, "user_id": 1,
    "date": "2026-08-01", "meal_type": "dinner",
    "food_name": "红烧肉", "portion": "200g",
    "calories": 600, "protein_g": 25, "fat_g": 45, "carbs_g": 15,
    "notes": "", "image_id": 42,
    "created_at": "2026-08-01T18:30:00Z"
  },
  {
    "id": 1, "user_id": 1,
    "date": "2026-08-01", "meal_type": "lunch",
    "food_name": "宫保鸡丁", "portion": "1份",
    "calories": 450, "protein_g": 30, "fat_g": 22, "carbs_g": 35,
    "notes": "有点辣", "image_id": null,
    "created_at": "2026-08-01T12:00:00Z"
  }
]
```

> 无记录的日期返回空数组 `[]`。

```bash
curl "http://localhost:3333/api/diet/logs?date=2026-08-01" \
  -H "Authorization: Bearer TOKEN"
```

---

### 5.3 删除记录

```
DELETE /api/diet/logs/:id
```

| 认证 | JWT |
|------|-----|

只能删除自己的记录。

**`200 OK`**

```json
{ "message": "删除成功" }
```

**`403`** — 无权删除他人记录

**`404`** — 记录不存在

```bash
curl -X DELETE http://localhost:3333/api/diet/logs/1 \
  -H "Authorization: Bearer TOKEN"
```

---

## 6. 每日汇总

```
GET /api/diet/summaries?start=2026-01-01&end=2026-08-01
```

| 认证 | JWT |
|------|-----|
| 参数 | `start`（必填）、`end`（必填），格式 `YYYY-MM-DD` |

返回用户指定日期范围内的每日营养汇总（7 天后自动聚合）。

**`200 OK`**

```json
[
  {
    "id": 1, "user_id": 1,
    "date": "2026-08-01",
    "total_calories": 1850, "total_protein_g": 72,
    "total_fat_g": 55, "total_carbs_g": 210,
    "meal_count": 3
  }
]
```

```bash
curl "http://localhost:3333/api/diet/summaries?start=2026-01-01&end=2026-08-31" \
  -H "Authorization: Bearer TOKEN"
```

---

## 7. 开发调试接口

以下接口仅用于开发阶段调试中间件，后续可移除。

### JWT 测试

```
GET /api/protected/example
```

| 认证 | JWT |
|------|-----|

**`200 OK`**

```json
{ "message": "受保护路由示例", "user_id": 1, "username": "zhangsan" }
```

### Internal 测试

```
GET /api/internal/example
```

| 认证 | Internal（`X-Internal-Token`） |
|------|-----|

**`200 OK`**

```json
{ "message": "内部鉴权通过" }
```

```bash
curl http://localhost:3333/api/internal/example \
  -H "X-Internal-Token: nutri-go-internal-token-dev"
```

---

## 接口总览

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/health` | 无 | 健康检查 |
| `POST` | `/api/auth/register` | 无 | 注册（限流：每 IP 5 次/分） |
| `POST` | `/api/auth/login` | 无 | 登录，签发访问+刷新令牌（限流：每 IP 5 次/分） |
| `POST` | `/api/auth/refresh` | 无 | 刷新令牌轮换（限流：每 IP 5 次/分） |
| `POST` | `/api/auth/logout` | JWT | 登出，吊销访问+刷新令牌 |
| `GET` | `/api/users/:id/profile` | JWT | 查看档案 |
| `PUT` | `/api/users/:id/profile` | JWT | 更新/创建档案 |
| `POST` | `/api/images/upload` | JWT | 上传食物图片 |
| `DELETE` | `/api/images/:id` | JWT | 删除图片 |
| `POST` | `/api/diet/logs` | JWT | 创建饮食记录 |
| `GET` | `/api/diet/logs` | JWT | 按日期查询记录 |
| `DELETE` | `/api/diet/logs/:id` | JWT | 删除记录 |
| `GET` | `/api/diet/summaries?start=&end=` | JWT | 每日营养汇总 |
| `GET` | `/api/images/:id` | Internal | Python 取图片元信息 |
| `GET` | `/api/images/:id/data` | Internal | Python 取图片二进制 |
| `GET` | `/api/internal/users/:id/profile` | Internal | Python 查档案 |
| `GET` | `/api/internal/diet/logs?user_id=&date=` | Internal | Python 查记录 |

---

## 附录 A：HTTP 状态码速查

| 状态码 | 含义 | 出现场景 |
|--------|------|---------|
| `200` | OK | 正常响应 |
| `201` | Created | 注册、创建资源成功 |
| `400` | Bad Request | 参数不满足约束、缺必填字段 |
| `401` | Unauthorized | JWT 缺失 / 无效 / 过期 |
| `403` | Forbidden | 越权操作（操作他人数据）、内部鉴权失败 |
| `404` | Not Found | 资源不存在或已被删除 |
| `409` | Conflict | 注册时用户名已存在 |
| `500` | Internal Server Error | 服务端异常 |

---

## 附录 B：curl 全流程测试

以下脚本从头走通完整业务流程：

```bash
BASE="http://localhost:3333"

# === 认证 ===
curl -s $BASE/api/health

curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"pass123"}'

TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"pass123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

AUTH="Authorization: Bearer $TOKEN"
INTERNAL="X-Internal-Token: nutri-go-internal-token-dev"

echo "TOKEN=$TOKEN"

# === 健康档案 ===
curl -s $BASE/api/users/1/profile -H "$AUTH" | python3 -m json.tool

curl -s -X PUT $BASE/api/users/1/profile \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"height_cm":172,"weight_kg":68,"age":28,"gender":"male","goal":"gain_muscle","allergies":[],"dietary_habits":[]}'

# === 图片 ===
# 先生成一张测试图
python3 -c "
import struct,zlib
w=h=1
raw=b''
for y in range(h): raw+=b'\x00'+struct.pack('>B',0)+b'\x00\x00'
ihdr=struct.pack('>IIBBBBB',w,h,8,2,0,0,0)
ihdr_crc=struct.pack('>I',zlib.crc32(b'IHDR'+ihdr)&0xffffffff)
idat=struct.pack('>I',zlib.crc32(b'IDAT'+zlib.compress(raw))&0xffffffff)
iend=struct.pack('>I',zlib.crc32(b'IEND')&0xffffffff)
with open('test.png','wb') as f:
    f.write(b'\x89PNG\r\n\x1a\n')
    f.write(struct.pack('>I',13)+b'IHDR'+ihdr+ihdr_crc)
    f.write(struct.pack('>I',len(zlib.compress(raw)))+b'IDAT'+zlib.compress(raw)+idat)
    f.write(struct.pack('>I',0)+b'IEND'+iend)
"

curl -s -X POST $BASE/api/images/upload -H "$AUTH" -F "image=@test.png"
rm test.png

# === 饮食记录 ===
curl -s -X POST $BASE/api/diet/logs \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"date":"2026-08-01","meal_type":"breakfast","food_name":"燕麦粥","portion":"1碗","calories":350,"protein_g":12,"fat_g":6,"carbs_g":60}'

curl -s -X POST $BASE/api/diet/logs \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"date":"2026-08-01","meal_type":"lunch","food_name":"宫保鸡丁","portion":"1份","calories":450,"protein_g":30,"fat_g":22,"carbs_g":35}'

# 查询当日全部记录
curl -s "$BASE/api/diet/logs?date=2026-08-01" -H "$AUTH" | python3 -m json.tool

# === 内部接口 ===
curl -s $BASE/api/internal/example -H "$INTERNAL"

# 查图片元信息（把 ID 换成实际值）
curl -s $BASE/api/images/1 -H "$INTERNAL" | python3 -m json.tool
```
