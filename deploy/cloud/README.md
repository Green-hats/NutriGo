# 手机 App 的云端服务

该模板在一台服务器运行 Caddy + Go + Python Agent。手机界面随 Tauri 安装包分发，服务器只提供 API，不托管前端页面。现有 SQLite 与图片目录使用独立持久卷，适合单实例起步。

## 配置与启动

准备 Linux 服务器、Docker Compose，以及指向服务器的 API 域名。仅开放公网 TCP 80 / 443；UDP 443 为可选 HTTP/3。Go 3333 与 Agent 8000 不映射到宿主机。Caddy 在域名解析正确后自动申请 HTTPS 证书。

在仓库根目录操作：

```bash
cp deploy/cloud/.env.example deploy/cloud/.env
openssl rand -hex 32
openssl rand -hex 32
```

编辑 `deploy/cloud/.env`，分别填入两个独立生成的 `JWT_SECRET`、`INTERNAL_TOKEN`，再填写 `API_DOMAIN`（仅主机名）及 LLM 配置。Go 与 Agent 使用相同的一组服务密钥。该文件不要提交到 Git。

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml config --quiet
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml up -d --build
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml ps
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml logs --tail=100 agent
```

首次构建需要下载 PyTorch、CLIP 和嵌入模型，耗时与内存取决于服务器和网络。网关等待服务就绪后启动。RAG 数据需要另外恢复到 Chroma 卷；本模板不会虚构或自动补齐缺失的数据。

## 路由

| 公网路径 | 服务 |
|---|---|
| `/api/auth/*`、`/api/users/*`、`/api/diet/*` | Go，保留 JWT 校验 |
| `/api/images/upload`、`DELETE /api/images/:id` | Go 图片上传与删除 |
| `/agent-api/*` | 转换为 Agent `/api/*`，即时转发 SSE |
| `/api/health`、`/api/ready` | Go 探活 |
| 其他路径 | 404；内部图片读取和 Go 内部接口不经公网代理 |

Agent 的所有受保护接口在本地验签后，会通过容器内网调用 Go 的
`GET /api/internal/auth/verify`，同时携带服务令牌与用户访问令牌。
Go 使用与普通 API 相同的 JWT 黑名单校验，因此退出登录后，已吊销的访问令牌
无法再发起 Agent 请求，图片缓存也不会绕过校验。该校验不缓存结果；
Go 不可达或无法查询吊销状态时，Agent 返回 503，不会降级放行。
健康检查不依赖该接口。升级时先更新 Go，再更新 Agent；旧版 Go 没有此接口。

```bash
curl https://api.your-domain.com/api/health
curl https://api.your-domain.com/agent-api/health
```

随后将同一 HTTPS 源地址写入 App 的 `VITE_API_BASE_URL`，按 [手机端文档](../../docs/MOBILE.md) 重新打包。原生 HTTP 插件不依赖浏览器 CORS；如果还要从浏览器跨域调试 Agent，可单独设置 `CORS_ORIGINS`。

## 数据与维护

本地和 CI 可运行 `python3 deploy/cloud/tests/verify_gateway.py`，需要 PATH 中存在 Caddy，也可通过 `CADDY_BIN` 指定可执行文件。该测试使用临时端口和模拟上游，验证鉴权头、请求内容、路径重写、内部接口阻断及 SSE 首包，不需要云账号。

| 卷 | 内容 |
|---|---|
| `backend-data` | `/data/data.db` 与 `/data/uploads` |
| `agent-data` | Agent 会话数据库 |
| `chroma-data` | RAG 向量库 |
| `model-data` | 模型缓存 |
| `caddy-data`、`caddy-config` | HTTPS 证书与 Caddy 状态 |

升级使用同一个 compose 项目执行 `up -d --build`。正常停止用 `down`，不要加 `-v`，否则会删除数据卷。备份时停止写入后复制数据库与图片卷，或使用 SQLite 在线备份接口；不要仅复制正在写入的 `.db` 文件而遗漏 WAL。

已有部署的数据不会自动迁入这些新卷，切换前应备份并恢复数据。SQLite、进程内限流和会话锁目前按单实例运行；水平扩容需要另行迁移数据库及共享状态。本次提供的是部署模板，未连接或部署到真实云服务器。
