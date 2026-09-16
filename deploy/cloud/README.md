# 手机 App 的云端服务

该模板在一台服务器运行 Caddy + Go + Python Agent。手机界面随 Tauri 安装包分发，服务器只提供 API，不托管前端页面。现有 SQLite 与图片目录使用独立持久卷，适合单实例起步。

## 配置与启动

准备 Linux 服务器和 Docker Compose。可以使用指向服务器的 API 域名，也可以直接使用公网 IP。云平台安全组与主机防火墙均需开放公网 TCP 80 / 443；UDP 443 为可选 HTTP/3。Go 3333 与 Agent 8000 不映射到宿主机。Caddy 自动申请和续期 HTTPS 证书。

在仓库根目录操作：

```bash
cp deploy/cloud/.env.example deploy/cloud/.env
openssl rand -hex 32
openssl rand -hex 32
```

编辑 `deploy/cloud/.env`，分别填入两个独立生成的 `JWT_SECRET`、`INTERNAL_TOKEN`，再填写 `API_DOMAIN`（仅域名或 IP，不含协议、端口、路径）及 LLM 配置。Go 与 Agent 使用相同的一组服务密钥。该文件不要提交到 Git，建议执行 `chmod 600 deploy/cloud/.env`。

没有域名时，使用公网 IP 证书配置：

```dotenv
API_DOMAIN=你的公网IP
CADDY_CONFIG_FILE=./Caddyfile.ip
```

此配置需要 Caddy 2.11 或更新版本，通过 ACME `shortlived` profile 申请 IP 证书。IP 证书有效期较短，必须保持 Caddy 运行、证书卷持久化，并保持公网 80 / 443 可达以自动续期。`default_sni` 用于给不发送 SNI 的 IP 客户端选择正确证书，包括 Docker/NAT 部署。无需让手机忽略证书校验。

尚未配置 AI 服务时，可先启用基础功能：

```dotenv
LLM_API_KEY=
AI_ENABLED=false
PRELOAD_MODELS=0
```

此时账号、档案、饮食记录、会话查询与营养计算正常运行；AI 对话、重新生成和照片识别在鉴权后返回 HTTP 409，提示“AI 功能尚未配置”，且不会创建空会话或回滚既有消息。关闭 AI 会跳过 RAG 初始化；`PRELOAD_MODELS=0` 只跳过构建时下载模型权重，仍安装运行依赖。

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml config --quiet
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml up -d --build
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml ps
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml logs --tail=100 agent
```

如果服务器访问默认软件源缓慢，可在 `.env` 中配置可信的 `DEBIAN_MIRROR`、`GOPROXY` 和 `PIP_INDEX_URL`；这些参数仅用于镜像构建，不修改宿主机的软件源。Go 保留模块校验，Debian 保留仓库签名验证，PyTorch 始终从官方 CPU 源下载。

首次构建需要下载 Python/PyTorch 依赖；`PRELOAD_MODELS=1` 时还会下载 CLIP 和嵌入模型，耗时与内存取决于服务器和网络。网关等待服务就绪后启动。RAG 数据需要另外恢复到 Chroma 卷；本模板不会虚构或自动补齐缺失的数据。

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

## 后续启用 AI

仅启用云端文字对话时，填写 LLM 配置并设置 `AI_ENABLED=true`、`RAG_ENABLED=false`、`FOOD_RECOGNITION_ENABLED=false`、`PRELOAD_MODELS=0`。文字对话和已有营养数据工具不依赖本地模型；照片识别会返回明确的未就绪提示，RAG 初始化也不会阻塞启动。DeepSeek 官方可使用 `LLM_MODEL=deepseek/deepseek-flash`、`LLM_BASE_URL=https://api.deepseek.com`，并设置 `LLM_REASONING_EFFORT=none` 使用非思考模式。仅将 Key 填入服务器 `.env` 的 `LLM_API_KEY`。

在服务器 `.env` 中填写实际供应商支持的 `LLM_MODEL`、`LLM_API_KEY`，必要时填写 `LLM_BASE_URL`，然后设置 `AI_ENABLED=true`。需要知识库与照片识别时，将 `RAG_ENABLED` 和 `FOOD_RECOGNITION_ENABLED` 也设为 `true`。确保服务器可以获取 Hugging Face 模型或已在 `model-data` 卷中准备模型缓存，并按需要恢复 RAG 数据。已有模型卷会覆盖镜像内的 `/models`，因此对已有部署仅重新构建镜像并不能补齐卷内缓存。可以先在同一个卷中下载模型：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml run --rm --no-deps agent python -c "from transformers import ChineseCLIPModel, ChineseCLIPProcessor; ChineseCLIPModel.from_pretrained('OFA-Sys/chinese-clip-vit-base-patch16'); ChineseCLIPProcessor.from_pretrained('OFA-Sys/chinese-clip-vit-base-patch16'); from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-zh-v1.5')"
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml up -d agent
```

如果模型下载网络不可达，保留 `AI_ENABLED=false`，待缓存准备完成后再启用。API Key 仅保存在服务器，不能放进 `VITE_*` 或 APK。

## 在已有服务器启用照片识别

照片识别使用 Chinese-CLIP，本地 CPU 推理，不需要额外的视觉 API Key。先在持久化的 `model-data` 卷准备模型，确认可加载后再开启服务。RAG 可以继续独立关闭。

可以从官方仓库下载固定版本（约 750 MB），避免拉取同仓库的重复权重：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml run --rm --no-deps agent python -c "from huggingface_hub import snapshot_download; snapshot_download('OFA-Sys/chinese-clip-vit-base-patch16', revision='36e679e65c2a2fead755ae21162091293ad37834', local_dir='/models/chinese-clip-vit-base-patch16', allow_patterns=['config.json', 'preprocessor_config.json', 'vocab.txt', 'pytorch_model.bin'])"
```

`pytorch_model.bin` 大小为 753177983 字节，官方 SHA-256 为 `7b7b583c210c867410bc6bdb8a55fe14eec62999e0a9ea31ff222dc501f9cfbe`。通过镜像站获取时同样应校验，不使用未经验证的替代权重。然后配置：

```dotenv
AI_ENABLED=true
FOOD_RECOGNITION_ENABLED=true
FOOD_MODEL_PATH=/models/chinese-clip-vit-base-patch16
FOOD_MODEL_PRELOAD=true
FOOD_MODEL_INT8=false
RAG_ENABLED=false
PRELOAD_MODELS=0
```

执行 `docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml up -d --build --no-deps agent`。服务启动时从本地加载权重并分批预计算 510 个家常菜候选；预热成功后才接受请求，不在用户第一次拍照时下载模型。单实例串行执行模型推理以控制内存，HTTP 事件循环仍可处理其他请求。

已有 App 会直接使用启用后的接口，无需重新打包。上线验证应覆盖登录、上传真实照片、返回五个候选、按克数计算、保存和查询饮食记录，以及他人图片访问被拒绝。模型分数只是当前候选集内的相对分数；用户仍需确认菜名和份量，目前不自动拆分一张照片里的多道菜。

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

已有部署的数据不会自动迁入这些新卷，切换前应备份并恢复数据。SQLite、进程内限流和会话锁目前按单实例运行；水平扩容需要另行迁移数据库及共享状态。部署后应分别验证 Go 与 Agent 的健康接口、真实登录、受保护请求及公网 HTTPS，而不能仅凭容器启动判断服务可用。
