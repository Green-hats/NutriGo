# NutriGo 部署入口

更新日期：2026-09-18。当前产品为 **Tauri 2 Android / iOS App + 单机云端 API**。新部署使用 [cloud/README.md](cloud/README.md)：Caddy 提供 HTTPS，Go / Agent 仅在 Compose 内网运行。前端资源随 App 安装包分发，无需单独的静态网页节点。

| 工作 | 文档 |
|---|---|
| 首次部署、域名 / IP HTTPS、模型和知识库准备 | [云端部署](cloud/README.md) |
| 更新服务、备份、恢复、检测与异地接入 | [云端运维](cloud/README.md#自动备份与恢复验证) |
| 数据保留、照片删除和备份范围 | [数据管理](../docs/DATA_MANAGEMENT.md) |
| 手机开发、API 地址、签名和 GitHub Release | [手机端](../docs/MOBILE.md) |
| 服务请求、卷与恢复拓扑 | [部署架构](docs/architecture.md) |
| 端到端设计、API 和扩展限制 | [系统架构](../docs/ARCHITECTURE.md) |

## 部署文件地图

| 文件 / 目录 | 当前用途 |
|---|---|
| [cloud/compose.yml](cloud/compose.yml) | 当前云端编排：Caddy、Go、Agent、按需 backup |
| [cloud/.env.example](cloud/.env.example) | 生产配置模板；真实 `.env` 仅保存在服务器 |
| [cloud/Caddyfile](cloud/Caddyfile)、[cloud/Caddyfile.ip](cloud/Caddyfile.ip) | 域名 / IP HTTPS 网关，阻断内部接口并支持 SSE |
| [cloud/backup](cloud/backup/) | 快照、校验、隔离恢复、异地接入、检测和 systemd 模板 |
| [cloud/tests/verify_gateway.py](cloud/tests/verify_gateway.py) | 路由、访问边界与流式传输验证 |
| [compose/Dockerfile.backend](compose/Dockerfile.backend)、[compose/Dockerfile.agent](compose/Dockerfile.agent) | 当前 cloud Compose 复用的镜像构建文件 |
| [compose/docker-compose.yml](compose/docker-compose.yml) | 旧版独立后端编排；不是当前手机云端部署入口 |
| [caddy/Caddyfile](caddy/Caddyfile) | 旧网页网关模板 |
| [scripts/build-frontend.sh](scripts/build-frontend.sh)、[scripts/deploy-frontend.sh](scripts/deploy-frontend.sh) | 旧静态网页构建 / 分发辅助脚本，手机发版不使用 |
| [scripts/setup-server.sh](scripts/setup-server.sh) | 服务器初始化辅助脚本；使用前审阅其主机修改和环境假设 |
| [scripts/capture-demo.mjs](scripts/capture-demo.mjs) | 本地演示截图 / GIF 工具，依赖和运行条件见脚本注释 |

## 从旧网页部署迁移

旧方案曾将静态网页网关与后端分在不同节点。相关文件保留供迁移核对，不应把旧端口开放或性能估算当作当前部署要求。

| 旧方案 | 当前方案 |
|---|---|
| 浏览器从服务器下载 React 静态站点 | React 打进 Tauri 安装包 |
| 网页节点跨主机访问 3333 / 8000 | 单机 Caddy 通过 Compose 网络访问服务 |
| CLIP 菜名候选为拍照主入口 | DeepSeek 多食物草稿；CLIP 仅兼容旧接口 |
| 随部署脚本复制数据库文件 | SQLite 在线快照、校验及隔离恢复 |
| 依赖默认模型下载和量化估算 | 固定模型 / 知识库快照，实际检索与识别验收 |

迁移前先盘点原 Compose 项目名、数据库路径、上传目录和卷，备份并验证可恢复，再调整挂载及入口。不要直接切换项目名导致创建空卷，不要执行 `down -v` 来升级。公网业务入口只需 80 / 443；管理 SSH 按服务器管理策略保留，Go / Agent 端口无需公网开放。

## 发版与检查

服务端更新和 App 发版分别进行。接口先兼容客户端，再发布新 APK；GitHub Actions 当前不会自动部署云端。纯文档更新不需要重建服务或发布 APK。

上线检查应覆盖 HTTPS、Go / Agent 就绪、真实账号登录、照片分析、聊天工具、RAG 实际检索和备份恢复。健康探针只证明相应进程 / 数据库可响应，不代表整个业务链路或模型质量通过。

截至本次核对，生产已启用本机每日备份与每小时检测；独立异地存储和 webhook 尚未配置。接入完成须经实际复制和读回校验，详细边界见[数据管理](../docs/DATA_MANAGEMENT.md)。
