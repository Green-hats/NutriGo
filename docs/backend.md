# Go 数据服务

核对日期：2026-09-18。Go + Gin + GORM + SQLite 提供账号、档案、饮食、汇总、图片及令牌管理；开发端口为 `3333`。生产由 Caddy 转发 `/api/*`，Go 端口不直接公开。字段、状态码与完整路由见 [API 文档](../backend/API.md)。

## 启动与配置

```bash
cd backend
go run ./cmd/server
```

也可在仓库根目录运行 `./start.sh`。Go 直接读取环境变量，配置样例见 [backend/.env.example](../backend/.env.example)，不会自动加载该样例。生产由 [Compose](../deploy/cloud/compose.yml) 注入；生产模式缺失或使用开发密钥会拒绝启动。数据库迁移目前使用 GORM `AutoMigrate`，尚无版本化迁移及自动降级流程。

## 源码分工

| 文件 / 目录 | 职责 |
|---|---|
| [cmd/server/main.go](../backend/cmd/server/main.go) | 初始化、建表、路由、后台任务、优雅关闭 |
| [internal/config](../backend/internal/config/) | SQLite、密钥、令牌和认证限流配置 |
| [handler/auth.go](../backend/internal/handler/auth.go) | 注册、登录、刷新轮换、登出、令牌校验 |
| [handler/profile.go](../backend/internal/handler/profile.go) | 个人档案读写与内部查询 |
| [handler/diet.go](../backend/internal/handler/diet.go) | 单条饮食 CRUD、字段校验与归属检查 |
| [handler/diet_batch.go](../backend/internal/handler/diet_batch.go) | 1–12 条记录事务保存与 UUID 防重 |
| [handler/summary.go](../backend/internal/handler/summary.go) | 实时明细与历史基数合并汇总 |
| [handler/image.go](../backend/internal/handler/image.go) | 上传、归属、元信息、二进制及删除入口 |
| [middleware](../backend/internal/middleware/) | JWT、内部令牌、限流、请求日志和指标 |
| [service/image_deletion.go](../backend/internal/service/image_deletion.go) | 持久化文件删除任务 |
| [service/cleanup.go](../backend/internal/service/cleanup.go) | 图片过期清理、删除重试、磁盘对账 |
| [service/token_cleanup.go](../backend/internal/service/token_cleanup.go) | 令牌清理 |

## 路由与信任边界

| 分组 | 路由 |
|---|---|
| 无用户认证 | `/api/health`、`/api/ready`、`/api/metrics`；注册、登录、刷新 |
| 用户 JWT | 登出；本人档案；图片上传/删除；饮食新增、批量新增、列表、修改、删除；营养汇总 |
| `X-Internal-Token` | 图片元信息/文件；内部档案、饮食、汇总查询 |
| 内部令牌 + 用户 JWT | `/api/internal/auth/verify` |

`/api/metrics` 在 Go 服务内无用户认证，公网 Caddy 会阻断它与内部接口。内部令牌授权服务间访问，不应发给 App；Agent 必须先根据用户 JWT 检查数据归属。JWT 中间件校验签名、到期及吊销状态，不等于每次重新查询账号状态。

业务错误使用 `{code,message}`，图片成功读取返回二进制，指标返回 Prometheus 文本。`health` 只证明进程可响应，`ready` 检查数据库连接；它们都不能替代照片、AI 或 RAG 端到端验证。

## 数据和写入规则

| 表 | 作用 |
|---|---|
| `users`、`user_profiles` | 账号、bcrypt 密码、健康档案 |
| `food_diaries` | 按用户和日期保存完整饮食明细 |
| `daily_summaries` | 旧版聚合基数；当前汇总合并实时明细，不再删明细 |
| `diet_batches` | 用户 + UUID 唯一约束、规范化请求哈希、原始保存回执 |
| `food_images` | 照片归属、路径、上传时间等元数据 |
| `image_deletions` | 已移除元数据但待完成文件清理的持久化任务 |
| `refresh_tokens`、`blacklisted_tokens` | 刷新令牌哈希、令牌家族与访问令牌吊销记录 |

整餐首次提交返回 `201`；相同 UUID 和内容重试返回 `200`，内容冲突返回 `409`。所有记录和回执一起提交；回执不随之后的编辑、删除而变化。单条新增尚无相同的通用防重机制。

档案年龄接受 0–150 的整数，身高体重可为小数。档案不存在时返回空档案；读取失败返回 `500`，保存前查询故障也不会错误地走创建分支。其他档案字段仍有校验待补全，不能把 UI 选项视为完整的服务端枚举约束。

## 图片与后台任务

上传准入在读取 multipart 前执行，默认每用户 10 次/分钟（突发 3）、每用户 1 个/全站 4 个在途请求；个人照片上限 512 MiB/1000 张，全站 10 GiB/20,000 张，磁盘至少保留 2 GiB 及在途余量。删除任务保留用户和字节，未完成清理仍计入配额。普通 JSON 解析前限制 64 KiB。状态码、调参和并发预留机制见[请求与资源限制](RESOURCE_LIMITS.md)。

图片实际类型限定为 JPEG / PNG / WebP，单图最多 10 MiB，完整 multipart 最多 11 MiB；使用 UUID 文件名，文件完成写入后登记元数据。删除时事务检查日记引用：有关联返回 `409`；无关联时移除元数据并持久化删除任务，再处理文件。完成返回 `200`，需要后台重试返回 `202`。

| 任务 | 调度 | 行为 |
|---|---|---|
| 图片任务 | 启动及每小时 | 重试删除任务；对账超过 24 小时的未登记应用文件；清理上传满保留期且无引用的照片 |
| 令牌任务 | 启动及每 6 小时 | 清理过期黑名单和过期 / 已吊销刷新令牌 |

`UNATTACHED_IMAGE_RETENTION_DAYS` 默认 7；`0` 仅关闭未关联照片的到期清理。照片仍有任何日记引用就保留；删除日记不会立即删照片。账号、会话、回执、照片和备份的详细保留与删除边界见[数据管理](DATA_MANAGEMENT.md)。

## 认证与运维

访问令牌为 HS256 JWT，当前签发有效期 2 小时并带唯一 `jti`；刷新令牌有效期 14 天，每次刷新轮换，重放会吊销同家族令牌。登出将当前访问令牌加入黑名单，并按请求吊销刷新令牌。认证接口默认每分钟 5 次，参数由 `AUTH_RATE_LIMIT_PER_MIN` / `AUTH_RATE_LIMIT_BURST` 控制。

SQLite 数据、uploads 和备份均需使用持久卷；更新服务保留原 Compose 项目和卷名。自动备份、恢复、磁盘检测及可选异地存储见[部署说明](../deploy/cloud/README.md)。

## 验证

在仓库根目录运行：

```bash
(cd backend && go test ./internal/... && go vet ./...)
python3 -m unittest discover -s deploy/cloud/backup -p 'test_*.py'
```

Go 单测覆盖认证、归属、饮食与批量事务、汇总、图片删除失败和重试、文件对账、档案故障处理及中间件。HTTP 集成测试 `backend/tests/test_api.py` 需要独立测试服务和干净数据库，会创建和修改测试数据；CI 会自行构建并启动该服务，不应对生产地址执行。完整检查步骤见[贡献指南](../CONTRIBUTING.zh-CN.md)。
