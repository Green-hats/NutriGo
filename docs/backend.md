# Go 后端文档

## 概述

数据服务层，负责用户认证、健康档案、饮食记录、图片存储。端口 **3333**。

技术栈：Gin + GORM + SQLite + golang-jwt

## 启动

```bash
cd backend && go run ./cmd/server
# 或
cd NutriGo && ./start.sh
```

## 目录结构

```
backend/
├── cmd/server/main.go          # 程序入口
├── internal/
│   ├── config/
│   │   ├── db.go               # SQLite 连接
│   │   └── jwt.go              # JWT 签发/验证
│   ├── handler/
│   │   ├── auth.go             # 注册/登录
│   │   ├── profile.go          # 健康档案（用户+内部）
│   │   ├── image.go            # 图片上传/删除/元信息/二进制
│   │   ├── diet.go             # 饮食记录 CRUD + 内部查询
│   │   └── summary.go          # 每日汇总查询
│   ├── middleware/
│   │   ├── jwt.go              # JWT 认证中间件
│   │   └── internal_auth.go    # 内部服务鉴权
│   ├── model/
│   │   ├── user.go             # User + UserProfile
│   │   ├── food_image.go       # FoodImage
│   │   ├── food_diary.go       # FoodDiary
│   │   └── daily_summary.go    # DailySummary
│   └── service/
│       ├── cleanup.go          # 图片定时清理（每 1h）
│       └── aggregator.go       # 饮食记录定时聚合（每 24h）
├── uploads/                    # 图片存储目录
├── API.md                      # API 文档
└── test_api.py                 # 66 个测试用例
```

## 路由（17 条）

### 公共路由（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |

### 受保护路由（JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
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

## 数据库表

| 表 | 说明 | 生命周期 |
|----|------|---------|
| `users` | 用户账号 | 永久 |
| `user_profiles` | 健康档案（1:1） | 永久 |
| `food_images` | 食物图片记录 | 7 天后清理 |
| `food_diaries` | 每日饮食明细 | 7 天后聚合删除 |
| `daily_summaries` | 每日营养汇总 | 永久 |

## 后台任务

| 任务 | 频率 | 功能 |
|------|------|------|
| ImageCleanup | 每 1h | 删除 7 天前图片（磁盘+数据库） |
| DietAggregator | 每 24h | 聚合 7 天前记录 → daily_summaries + 删除原记录 |

## 测试

```bash
cd backend && python3 test_api.py
```

66 个测试用例，覆盖所有路由和鉴权逻辑。
