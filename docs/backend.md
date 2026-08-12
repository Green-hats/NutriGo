# Go 后端文档

## 概述

数据服务层，负责用户认证、健康档案、饮食记录、图片存储、每日汇总聚合。端口 **3333**。

技术栈：Gin + GORM + SQLite + golang-jwt + golang.org/x/time

## 启动

```bash
cd backend && go run ./cmd/server
# 或
cd NutriGo && ./start.sh
```

## 目录结构

```
backend/
├── cmd/server/main.go          # 程序入口（优雅关闭、后台任务、路由）
├── internal/
│   ├── config/
│   │   ├── db.go               # SQLite 连接
│   │   ├── jwt.go              # JWT 签发/刷新令牌生成/哈希
│   │   ├── retention.go        # 聚合保留期常量
│   │   └── rate_limit.go       # 认证接口限流配置
│   ├── handler/
│   │   ├── auth.go             # 注册/登录/刷新令牌/登出
│   │   ├── profile.go          # 健康档案（用户+内部）
│   │   ├── image.go            # 图片上传/删除/元信息/二进制
│   │   ├── diet.go             # 饮食记录 CRUD + 内部查询
│   │   ├── summary.go          # 每日汇总查询（合并实时+聚合表）
│   │   └── validate.go         # 日期参数校验
│   ├── middleware/
│   │   ├── jwt.go              # JWT 认证 + 黑名单校验
│   │   ├── internal_auth.go    # 内部服务鉴权
│   │   ├── rate_limit.go       # IP 令牌桶限流
│   │   └── observability.go    # 请求日志 + /metrics 指标
│   ├── model/
│   │   ├── user.go             # User + UserProfile
│   │   ├── food_image.go       # FoodImage
│   │   ├── food_diary.go       # FoodDiary
│   │   ├── daily_summary.go    # DailySummary
│   │   └── token.go            # RefreshToken + BlacklistedToken
│   └── service/
│       ├── cleanup.go          # 图片定时清理（每 1h）
│       ├── aggregator.go       # 饮食记录定时聚合（每 24h）
│       └── token_cleanup.go    # 过期令牌清理（每 6h）
├── uploads/                    # 图片存储目录（.gitignore）
└── API.md                      # API 文档
```

## 路由（22 条）

### 公共路由（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/ready` | 就绪探针（校验 DB 连接） |
| GET | `/api/metrics` | Prometheus 格式指标 |
| POST | `/api/auth/register` | 注册（IP 限流） |
| POST | `/api/auth/login` | 登录，签发访问+刷新令牌（IP 限流） |
| POST | `/api/auth/refresh` | 刷新令牌轮换（IP 限流） |

### 受保护路由（JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/logout` | 登出，吊销访问+刷新令牌 |
| GET | `/api/users/:id/profile` | 查看档案 |
| PUT | `/api/users/:id/profile` | 更新/创建档案 |
| POST | `/api/images/upload` | 上传图片 |
| DELETE | `/api/images/:id` | 删除图片 |
| POST | `/api/diet/logs` | 创建饮食记录 |
| GET | `/api/diet/logs?date=` | 按日期查询 |
| DELETE | `/api/diet/logs/:id` | 删除记录 |
| GET | `/api/diet/summaries?start=&end=` | 每日汇总 |

### 内部路由（InternalAuth）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/images/:id` | Python 取图片元信息 |
| GET | `/api/images/:id/data` | Python 取图片二进制 |
| GET | `/api/internal/users/:id/profile` | Python 查档案 |
| GET | `/api/internal/diet/logs?user_id=&date=` | Python 查记录 |
| GET | `/api/internal/diet/summaries?user_id=&start=&end=` | Python 查汇总 |

## 数据库表

| 表 | 说明 | 生命周期 |
|----|------|---------|
| `users` | 用户账号（bcrypt 密码） | 永久 |
| `user_profiles` | 健康档案（1:1） | 永久 |
| `food_images` | 食物图片记录 | 7 天后清理 |
| `food_diaries` | 每日饮食明细 | 7 天后聚合删除 |
| `daily_summaries` | 每日营养汇总 | 永久 |
| `refresh_tokens` | 刷新令牌（SHA-256 哈希 + 家族 ID） | 14 天/轮换后清除 |
| `blacklisted_tokens` | 登出吊销的访问令牌（jti） | 到期清除 |

## 后台任务

| 任务 | 频率 | 功能 |
|------|------|------|
| ImageCleanup | 每 1h | 删除 7 天前图片（磁盘+数据库） |
| DietAggregator | 每 24h | 聚合 7 天前记录 → daily_summaries + 删除原记录 |
| TokenCleanup | 每 6h | 清理过期黑名单与过期/已吊销刷新令牌 |

## 安全

- JWT（HS256，2h）携带唯一 `jti`；登录签发访问+刷新令牌对
- 刷新令牌只存 SHA-256 哈希；每次刷新轮换旧令牌，重放检测吊销整个令牌家族
- 登出将 jti 加入黑名单立即失效（与 refresh 吊销在同一事务）
- 登录/注册/刷新接口 IP 级令牌桶限流（5 次/分，超限 429）
- 图片上传：类型嗅探（仅 jpg/png/webp）+ 10MB 上限 + UUID 文件名

## 测试

### 单元测试（无需启动服务）

```bash
cd backend && go test ./...
```

75 个用例，覆盖：JWT 签发/过期/黑名单、auth（注册/登录/刷新/登出）、diet、image、middleware（JWT/内部鉴权/限流/指标）、service（聚合/清理/令牌清理）。

### 集成测试（需 Go 服务运行）

```bash
cd backend && python3 ../test/backend/test_api.py
```

覆盖全部路由与鉴权逻辑。
