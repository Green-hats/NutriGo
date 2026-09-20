# NutriGo Go 后端 API 文档

核对日期：2026-09-18，服务端基线 `f72677b`。开发地址为 `http://localhost:3333`，云端经 HTTPS 网关访问 `/api/*`。业务响应主要为 JSON；图片读取返回二进制，指标返回文本。Agent 接口另见 [Agent 文档](../docs/agent.md)。

内部接口只供受信服务使用，公网网关阻断内部查询、图片读取及指标。数据保留与删除的完整规则见[数据管理](../docs/DATA_MANAGEMENT.md)。

---

## 统一错误响应契约

Go 业务处理器及认证中间件通过统一错误函数返回：

```json
{ "code": "VALIDATION_ERROR", "message": "参数无效: ..." }
```

| `code` | 含义 | 对应 HTTP |
|--------|------|-----------|
| `VALIDATION_ERROR` | 参数/请求体无效 | 400 |
| `UNAUTHORIZED` | 未认证 / 令牌无效 / 凭据错误 | 401 |
| `FORBIDDEN` | 越权访问 | 403 |
| `NOT_FOUND` | 资源不存在 | 404 |
| `CONFLICT` | 冲突（如用户名已存在） | 409 |
| `RATE_LIMITED` | 请求过于频繁 | 429 |
| `PAYLOAD_TOO_LARGE` | 请求体或图片过大 | 413 |
| `REQUEST_TIMEOUT` | 请求体读取超时 | 408 |
| `UNSUPPORTED_MEDIA_TYPE` | 不接受的请求体编码 | 415 |
| `RESOURCE_UNAVAILABLE` | 读取/上传资源不足或配额检查不可用 | 503 / 507 |
| `INTERNAL_ERROR` | 服务内部错误 | 500 |

前端按 `code` 分支处理，不依赖 `message` 文案。网关错误、未匹配路由或框架异常不保证使用该 JSON；客户端还需处理非 JSON 和连接失败。

> 认证接口限流默认 5 次/分，可通过环境变量 `AUTH_RATE_LIMIT_PER_MIN` / `AUTH_RATE_LIMIT_BURST` 覆盖（部署或集成测试调参）。

普通请求体最多 64 KiB，解析前按实际字节限制；单张图片 10 MiB、multipart 11 MiB。上传速率/并发超限 `429`；个人照片配额满 `409`；全站配额/磁盘不足 `507`。具体配置、默认值和旧任务迁移边界见[请求与资源限制](../docs/RESOURCE_LIMITS.md)。

## 分页约定

分页列表返回统一信封：

```json
{ "items": [], "total": 0, "limit": 30, "offset": 0 }
```

- 查询参数：`limit`（默认 30，最大 100）、`offset`（默认 0）
- `total` 为满足过滤条件的总条数，`items` 为当前页数据
- Go 的 `GET /api/diet/summaries` 使用此信封；饮食明细和内部汇总仍为数组。Agent 会话分页见独立文档。

---

## 目录

- [1. 健康检查](#1-健康检查)
- [2. 用户认证](#2-用户认证)
  - [2.1 注册](#21-注册)
  - [2.2 登录](#22-登录)
  - [2.3 刷新令牌](#23-刷新令牌)
  - [2.4 登出](#24-登出吊销令牌)
  - [2.5 JWT 使用说明](#25-jwt-使用说明)
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
  - [5.4 编辑记录](#54-编辑记录)
  - [5.5 整餐批量保存](#55-整餐批量保存)
- [6. 每日汇总](#6-每日汇总)
- [7. 开发调试接口](#7-开发调试接口)
- [8. 内部业务查询](#8-内部业务查询)
- [接口总览](#接口总览)
- [附录 A：HTTP 状态码速查](#附录-ahttp-状态码速查)
- [附录 B：本地调用示例](#附录-b本地调用示例)

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

### 就绪与指标

`GET /api/ready` 成功返回 `200` 和 `{"status":"ready"}`；数据库连接检查失败返回 `503` / `INTERNAL_ERROR`。`GET /api/metrics` 返回 Prometheus 文本，在 Go 内无用户认证，但公网 Caddy 阻断此路径。

`health` 不访问外部 AI，`ready` 不验证图片、RAG、模型或备份；业务能力需单独验收。

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
{ "code": "VALIDATION_ERROR", "message": "参数无效: Key: 'Username' Error:Field validation for 'Username' failed on the 'min' tag" }
```

**`409`** — 用户名已被注册

```json
{ "code": "CONFLICT", "message": "用户名已存在" }
```

**`500`** — 服务端异常

```json
{ "code": "INTERNAL_ERROR", "message": "密码加密失败" }
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
{ "code": "UNAUTHORIZED", "message": "用户名或密码错误" }
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

成功时返回与登录相同的响应（新的 `token` + `refresh_token`）。**轮换机制**：每次刷新都会吊销旧刷新令牌，防止重放；旧令牌再次使用返回 `401`，并触发**令牌家族吊销**（同一次登录派生的所有刷新令牌一并失效）。

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
| `age` | int | 年龄，0–150；0 也表示未填写 |
| `gender` | string | 客户端选项：`male` / `female` / `other` |
| `goal` | string | 客户端选项：`lose_weight` / `maintain` / `gain_muscle` |
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

**`200 OK`** — 返回更新后的完整档案。当前服务端对年龄做范围与整数校验，尚未完整约束身高体重范围及性别、目标等枚举；上表客户端选项不等于服务端枚举验证。

**`400`** — 年龄为小数、字符串、负数或超过 150 时，返回 `VALIDATION_ERROR` 和“年龄请输入 0–150 之间的整数”；其他 JSON 格式错误返回“档案格式不正确，请检查填写内容”。校验失败不写入任何档案字段。身高、体重支持小数，年龄不会自动取整。

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

档案读取遇到数据库故障返回 `500`，不会返回空档案；更新前读取失败也不会尝试创建档案。只有确实尚未填写档案时返回默认空值。

## 4. 图片管理

> 流程：前端上传图片到 Go → Python 通过内部接口获取图片二进制做 AI 识别 → 返回草稿供用户修正确认 → 整餐写入饮食记录 → 用户/前端可删除已解除全部日记关联的图片以释放磁盘空间。

### 4.1 上传图片

```
POST /api/images/upload
```

| 认证 | JWT |
|------|-----|
| Content-Type | `multipart/form-data` |
| 字段名 | `image` |

**安全限制**：嗅探实际 MIME，仅允许 JPEG / PNG / WebP；单图最多 10 MiB，完整 multipart 请求最多 11 MiB。文件名使用 UUID，扩展名根据实际 MIME 确定；文件同步、关闭后登记元数据。

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

**`400`** — 非支持的图片格式、文件过大或 multipart 无效

```json
{ "code": "VALIDATION_ERROR", "message": "只支持 jpg/png/webp 格式" }
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

只能删除自己的图片，且不得有任何日记引用。数据库事务先移除元信息并登记文件删除任务；文件删除失败保留任务，服务启动时及每小时重试。

**`200 OK`**

```json
{ "message": "删除成功" }
```

**`202 Accepted`** — 删除已受理，文件清理将自动重试；图片已不能重新关联或访问。再次 DELETE 可能返回 `404`，任务仍由后台处理。

**`409 Conflict`** — 图片仍被饮食记录引用，需先解除全部关联；不修改记录或文件。

**`500`** — 数据库操作失败，事务回滚并保留图片与文件。

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
| `meal_type` | string | 是 | `breakfast` / `lunch` / `dinner` / `snack` |
| `portion` | string | 否 | 份量，如 `"200g"`、`"1碗"` |
| `calories` | float | 否 | 热量（千卡） |
| `protein_g` | float | 否 | 蛋白质（克） |
| `fat_g` | float | 否 | 脂肪（克） |
| `carbs_g` | float | 否 | 碳水化合物（克） |
| `notes` | string | 否 | 备注 |
| `image_id` | int | 否 | 关联的食物图片 ID（可为 null） |

日期必须为真实日历日期；食物名称去空格后为 1～200 字符，份量最多 100 字符，备注最多 2000 字符。营养值必须为 0～1000000 的有限数，单位为本次食用总量，允许 0。图片 ID 必须为正数且属于当前用户；不存在或属于他人时统一返回 400。

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

只能删除自己的记录。删除立即影响实时汇总，但不会同步删除照片、整餐原始回执或历史备份；照片无引用后按独立保留规则处理。

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

### 5.4 编辑记录

```
PUT /api/diet/logs/:id
```

需 JWT，只能编辑自己的记录。请求体与创建一致，采用完整替换：日期、餐次、食物名必填，省略的可选字段清空或归零；`image_id: null` 解除图片关联。允许把营养值改为 0。成功返回 `200` 和更新后的记录，越权返回 `403`，不存在返回 `404`。校验失败不会写入任何字段；数据库读写失败返回 `500`，不会伪装为空列表或成功。

---

### 5.5 整餐批量保存

```http
POST /api/diet/logs/batch
Authorization: Bearer <token>
Content-Type: application/json
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `request_id` | string | 小写十六进制 UUID 格式 `8-4-4-4-12`，每次新提交生成；结果不确定时重用原值 |
| `records` | object[] | 1–12 项；每项字段及校验与单条创建相同 |

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "records": [{
    "date": "2026-09-18",
    "meal_type": "lunch",
    "food_name": "米饭",
    "portion": "150g",
    "calories": 174,
    "protein_g": 3.9,
    "fat_g": 0.45,
    "carbs_g": 38.85,
    "notes": "",
    "image_id": 42
  }]
}
```

`image_id` 要替换为当前用户已上传的图片 ID，或置为 `null`。所有记录、图片关联检查与提交回执在一个事务中完成，任意一项失败则全部回滚。

| HTTP | 返回 / 行为 |
|---|---|
| `201` | 首次成功：记录对象数组，结构与单条创建返回对象相同，顺序对应提交数组 |
| `200` | 同一用户、同一 `request_id`、相同规范化内容：原始响应数组，不再次插入 |
| `400` | UUID / 数量 / 字段无效，或图片不存在 / 不属于当前用户 |
| `409` | 同一 `request_id` 的内容变化，`CONFLICT` |
| `500` | 数据库写入失败，事务回滚 |

名称、份量和备注先去首尾空白，再计算请求摘要。重试须保留同一 UUID、记录顺序和内容；不能在超时后生成新 UUID 盲目再提交。回执按用户隔离；其他用户使用相同 UUID 不会取得本人的回执。

回执保留首次响应，之后编辑 / 删除日记不会重写它；再次重放不会重建已删除记录，也不能用回执判断当前日记状态。回执目前无自动过期清理，随用户数据库备份。普通 `POST /api/diet/logs` 尚无这一防重机制。

---

## 6. 每日汇总

```
GET /api/diet/summaries?start=2026-01-01&end=2026-08-01&limit=30&offset=0
```

| 认证 | JWT |
|------|-----|
| 参数 | `start`（必填）、`end`（必填），格式 `YYYY-MM-DD`；`limit`（可选，默认 30 最大 100）、`offset`（可选，默认 0） |

返回用户指定日期范围内的每日营养汇总，**分页信封**，日期倒序。日期须有效且 `start <= end`。所有日期均实时计算保留的明细，并叠加旧版历史汇总基数；新增、编辑、删除立即生效，不再聚合删除原记录。数据库查询失败返回 `500`。

**`200 OK`**

```json
{
  "items": [
    {
      "id": 0, "user_id": 1,
      "date": "2026-08-01",
      "total_calories": 1850, "total_protein_g": 72,
      "total_fat_g": 55, "total_carbs_g": 210,
      "meal_count": 3, "source": "live"
    }
  ],
  "total": 1, "limit": 30, "offset": 0
}
```

```bash
curl "http://localhost:3333/api/diet/summaries?start=2026-01-01&end=2026-08-31" \
  -H "Authorization: Bearer TOKEN"
```

---

`source` 为 `live`（现存明细）、`aggregated`（旧历史基数）或 `mixed`（合并）。`meal_count` 对现存明细计的是记录条数，并非早餐 / 午餐等去重后的餐数。聚合结果没有可供编辑的稳定汇总 ID，当前 `id` 为零值；客户端按日期使用结果。

## 7. 开发调试接口

以下示例路由仍由 Go 注册，但当前公网网关不放行，不属于 App 业务功能。

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

## 8. 内部业务查询

以下接口只在受信网络中调用，要求 `X-Internal-Token`。此令牌授权服务级查询；Agent 必须先绑定已认证用户，不能接受模型指定任意用户 ID。App 不得持有此令牌。

### 8.1 访问令牌校验

```http
GET /api/internal/auth/verify
X-Internal-Token: <server-internal-token>
Authorization: Bearer <user-access-token>
```

成功返回 `200` 和 `{"user_id":1}`。使用与用户 API 相同的 JWT 签名、有效期和黑名单检查；不等于查询账号当前是否存在。内部令牌错误返回 `403`，JWT 无效 / 被吊销返回 `401`，无法查询吊销状态返回 `503`。

### 8.2 档案

`GET /api/internal/users/:id/profile` 返回指定用户档案，结构与公开档案查询相同；尚无档案时返回默认空值，数据库失败返回 `500`。此查询不以调用方 JWT 约束 `:id`，身份边界由 Agent 保证。

### 8.3 饮食明细

`GET /api/internal/diet/logs?user_id=1&date=2026-09-18` 返回指定用户、日期的记录数组，按创建时间倒序，无记录返回 `[]`。`user_id` 须为有效正数，日期须有效；参数错误 `400`，数据库失败 `500`。

### 8.4 每日汇总

`GET /api/internal/diet/summaries?user_id=1&start=2026-09-12&end=2026-09-18` 返回与公开汇总相同的条目结构及 `source`，但为**日期升序的普通数组，不分页**。无结果返回 `[]`；参数错误 `400`，数据库失败 `500`。

图片元信息与二进制的内部契约见第 4 节。

---

## 接口总览

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/health` | 无 | 健康检查 |
| `GET` | `/api/ready` | 无 | 就绪探针（校验数据库连接） |
| `GET` | `/api/metrics` | 无 | Prometheus 格式指标 |
| `POST` | `/api/auth/register` | 无 | 注册（限流：每 IP 5 次/分） |
| `POST` | `/api/auth/login` | 无 | 登录，签发访问+刷新令牌（限流：每 IP 5 次/分） |
| `POST` | `/api/auth/refresh` | 无 | 刷新令牌轮换（限流：每 IP 5 次/分） |
| `POST` | `/api/auth/logout` | JWT | 登出，吊销访问+刷新令牌 |
| `GET` | `/api/users/:id/profile` | JWT | 查看档案 |
| `PUT` | `/api/users/:id/profile` | JWT | 更新/创建档案 |
| `POST` | `/api/images/upload` | JWT | 上传食物图片 |
| `DELETE` | `/api/images/:id` | JWT | 删除图片 |
| `POST` | `/api/diet/logs` | JWT | 创建饮食记录 |
| `POST` | `/api/diet/logs/batch` | JWT | 事务批量保存，UUID 防重 |
| `GET` | `/api/diet/logs` | JWT | 按日期查询记录 |
| `PUT` | `/api/diet/logs/:id` | JWT | 完整替换本人记录 |
| `DELETE` | `/api/diet/logs/:id` | JWT | 删除记录 |
| `GET` | `/api/diet/summaries?start=&end=` | JWT | 每日营养汇总 |
| `GET` | `/api/images/:id` | Internal | Python 取图片元信息 |
| `GET` | `/api/images/:id/data` | Internal | Python 取图片二进制 |
| `GET` | `/api/internal/users/:id/profile` | Internal | Python 查档案 |
| `GET` | `/api/internal/diet/logs?user_id=&date=` | Internal | Python 查记录 |
| `GET` | `/api/internal/diet/summaries?user_id=&start=&end=` | Internal | Python 查汇总，升序数组 |
| `GET` | `/api/internal/auth/verify` | Internal + JWT | 校验访问令牌 |
| `GET` | `/api/protected/example` | JWT | 开发示例，网关阻断 |
| `GET` | `/api/internal/example` | Internal | 开发示例，网关阻断 |

---

## 附录 A：HTTP 状态码速查

| 状态码 | 含义 | 错误码 | 出现场景 |
|--------|------|--------|---------|
| `200` | OK | — | 正常响应 |
| `201` | Created | — | 注册、创建资源成功 |
| `202` | Accepted | — | 图片元数据删除已提交，文件清理待重试 |
| `400` | Bad Request | `VALIDATION_ERROR` | 参数不满足约束、缺必填字段 |
| `401` | Unauthorized | `UNAUTHORIZED` | JWT 缺失 / 无效 / 过期 |
| `403` | Forbidden | `FORBIDDEN` | 越权操作（操作他人数据）、内部鉴权失败 |
| `404` | Not Found | `NOT_FOUND` | 资源不存在或已被删除 |
| `409` | Conflict | `CONFLICT` | 用户名已存在、照片仍被引用、批次内容冲突 |
| `429` | Too Many Requests | `RATE_LIMITED` | 认证接口超限 |
| `500` | Internal Server Error | `INTERNAL_ERROR` | 服务端异常 |
| `503` | Service Unavailable | `INTERNAL_ERROR` | 数据库就绪或令牌吊销查询不可用 |

---

## 附录 B：本地调用示例

以下 Bash 示例仅用于已运行 Go 服务的独立开发环境，会创建测试账号和一条饮食记录。需要 curl 与 Python 3；不要启用 `set -x` 输出令牌。完整 HTTP 验证使用 `backend/tests/test_api.py`，运行条件见[贡献指南](../CONTRIBUTING.zh-CN.md)。

```bash
set -euo pipefail
NUTRIGO_BASE="http://localhost:3333"
NUTRIGO_LOGIN_BODY=$(python3 -c 'import json,uuid; print(json.dumps({"username":"demo_"+uuid.uuid4().hex[:12],"password":uuid.uuid4().hex}))')

curl -fsS "$NUTRIGO_BASE/api/ready"
curl -fsS -X POST "$NUTRIGO_BASE/api/auth/register" \
  -H 'Content-Type: application/json' -d "$NUTRIGO_LOGIN_BODY"
NUTRIGO_LOGIN=$(curl -fsS -X POST "$NUTRIGO_BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "$NUTRIGO_LOGIN_BODY")
NUTRIGO_TOKEN=$(printf '%s' "$NUTRIGO_LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
NUTRIGO_USER_ID=$(printf '%s' "$NUTRIGO_LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')

curl -fsS "$NUTRIGO_BASE/api/users/$NUTRIGO_USER_ID/profile" \
  -H "Authorization: Bearer $NUTRIGO_TOKEN"
curl -fsS -X POST "$NUTRIGO_BASE/api/diet/logs" \
  -H "Authorization: Bearer $NUTRIGO_TOKEN" -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-18","meal_type":"breakfast","food_name":"燕麦粥","portion":"1碗","calories":350,"protein_g":12,"fat_g":6,"carbs_g":60}'
curl -fsS "$NUTRIGO_BASE/api/diet/logs?date=2026-09-18" \
  -H "Authorization: Bearer $NUTRIGO_TOKEN" | python3 -m json.tool

NUTRIGO_LOGOUT_BODY=$(printf '%s' "$NUTRIGO_LOGIN" | python3 -c 'import json,sys; print(json.dumps({"refresh_token":json.load(sys.stdin)["refresh_token"]}))')
curl -fsS -X POST "$NUTRIGO_BASE/api/auth/logout" \
  -H "Authorization: Bearer $NUTRIGO_TOKEN" -H 'Content-Type: application/json' \
  -d "$NUTRIGO_LOGOUT_BODY"
unset NUTRIGO_LOGIN_BODY NUTRIGO_LOGIN NUTRIGO_TOKEN NUTRIGO_USER_ID NUTRIGO_LOGOUT_BODY
```

示例只演示认证、本人档案读取与手动记录；不会测试模型、照片、RAG 或生产恢复。测试数据留在独立开发库中，当前没有账号注销接口。
