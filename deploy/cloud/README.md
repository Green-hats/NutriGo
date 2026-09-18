# 手机 App 的云端服务

核对日期：2026-09-18，服务端数据修复基线 `f72677b`。本文是当前生产部署入口；[数据管理](../../docs/DATA_MANAGEMENT.md)说明保留、删除与恢复边界，[部署架构](../docs/architecture.md)说明请求及备份拓扑。

该模板在一台服务器运行 Caddy + Go + Python Agent。手机界面随 Tauri 安装包分发，服务器只提供 API，不托管前端页面。现有 SQLite 与图片目录使用独立持久卷，适合单实例起步。

## 配置与启动

准备 Linux 服务器和 Docker Compose。可以使用指向服务器的 API 域名，也可以直接使用公网 IP。云平台安全组与主机防火墙均需开放公网 TCP 80 / 443；UDP 443 为可选 HTTP/3。Go 3333 与 Agent 8000 不映射到宿主机。Caddy 自动申请和续期 HTTPS 证书。

在仓库根目录操作：

```bash
if [ ! -f deploy/cloud/.env ]; then
  cp deploy/cloud/.env.example deploy/cloud/.env
fi
openssl rand -hex 32
openssl rand -hex 32
```

编辑 `deploy/cloud/.env`，分别填入两个独立生成的 `JWT_SECRET`、`INTERNAL_TOKEN`，再填写 `API_DOMAIN`（仅域名或 IP，不含协议、端口、路径）及 LLM 配置。Go 与 Agent 使用相同的一组服务密钥。该文件不要提交到 Git，建议执行 `chmod 600 deploy/cloud/.env`。

`APP_TIMEZONE` 默认为 `Asia/Shanghai`（北京时间）。Agent 每次请求都会按此时区刷新“今天”，默认近 7 天汇总也使用相同日期；服务器或容器保持 UTC 不影响查询。恢复会话和重新生成会重新计算日期，已保存的历史回复保持原文。面向其他时区部署时改为相应的 IANA 时区并重建 Agent 容器；当前未按每个手机自动切换时区。

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

此时账号、档案、饮食记录、会话查询与营养计算正常运行；AI 对话、重新生成和照片识别在鉴权后返回 HTTP 409，提示对应功能尚未配置，且不会创建空会话或回滚既有消息。关闭 AI 会跳过 RAG 初始化；`PRELOAD_MODELS=0` 只跳过构建时下载模型权重，仍安装运行依赖。

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

## DeepSeek V4.1 照片分析（Android 0.1.3 起）

新版 App 使用 `/agent-api/analyze-meal`。在服务器配置 `AI_ENABLED=true`、`FOOD_RECOGNITION_ENABLED=true`、`FOOD_VISION_MODEL=deepseek-flash`。`FOOD_VISION_API_KEY` 只填在服务器；若聊天也使用 DeepSeek 官方端点和 `deepseek/` 模型，可留空并复用 `LLM_API_KEY`。如果聊天用其他供应商或代理，必须单独配置视觉密钥。

新接口直接发送照片给 DeepSeek 官方，返回多项食物、估重范围、营养及假设；精确菜名可采用营养库参考值。用户可修改实际份量，确认后才保存记录。模型给出的范围不是称重测量或统计置信区间。`deepseek-flash` 是项目当前配置，供应商模型可用性需通过实际请求验证；健康探针不能验证该能力。

先备份，再构建并更新 backend、agent，验收时先确认 Go 就绪；后端自动迁移新增 `diet_batches` 回执表和 `image_deletions` 删除任务表。新 APK 的批量保存依赖新 Go 接口，不能只更新 Agent。保持全部数据卷；旧版 `/identify-food` 和 `/calculate-intake` 继续可用。检查新版上传→分析→编辑→批量保存→查询，并用同一提交编号重试确认无重复记录。无需更改 Caddy 路由。

不再服务旧 APK 时可关闭 `FOOD_MODEL_PRELOAD`，避免启动时预热 CLIP；旧接口首次调用仍会懒加载，不要在仍需兼容旧版时删除模型卷。

## 旧版 APK 的 Chinese-CLIP 兼容接口

旧接口使用 Chinese-CLIP，本地 CPU 推理，不需要额外的视觉 API Key。先在持久化的 `model-data` 卷准备模型，确认可加载后再开启服务。RAG 可以继续独立关闭。

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

使用旧识别接口的 App 会直接获得此能力，无需为服务开关重新打包。上线验证应覆盖登录、上传真实照片、返回五个候选、按克数计算、保存和查询饮食记录，以及他人图片访问被拒绝。模型分数只是当前候选集内的相对分数；用户仍需确认菜名和份量，目前该旧接口不自动拆分一张照片里的多道菜；新版整餐分析使用上一节的 DeepSeek 流程。

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

## 自动备份与恢复验证

饮食明细不再按 7 天删除。被日记引用的照片持续保留；未关联照片默认按上传时间 7 天后清理，可用 `UNATTACHED_IMAGE_RETENTION_DAYS=0` 关闭这项保留期清理。仍被日记引用的照片禁止手动删除（409）。删除任务与元信息移除在同一事务内登记，文件删除失败返回 202 并在每次启动、之后每小时重试；此重试不受保留期设置影响。上传失败会移除已写入文件；未入库的 UUID 图片文件超过 24 小时后核对清理，不处理新文件、未知文件名和符号链接。每日汇总实时计算保留的明细，并保留旧版本历史汇总基数；已经被旧版本删除的明细需要旧备份才能恢复。

维护服务使用 SQLite 在线备份接口快照 Go 与 Agent 数据库，同时复制快照引用的图片。每份备份校验 SHA-256、SQLite 完整性和表行数，并实际恢复到隔离目录再次校验。验证成功后才清理旧备份，默认保留最近 14 份（`BACKUP_KEEP`）。该服务无需网络，不接触 API Key；数据库只读连接使用可写卷挂载，以兼容 SQLite 的 WAL 共享内存文件。

在项目根目录执行首次备份：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml run --rm --no-deps backup
```

备份保存在项目的 `backups/snapshot-*`，目录权限为 700，已忽略 Git。上面的命令仅执行本地备份；定时任务改由主机 Python 3.9+ 的 `operations.py` 编排本地备份、可选异地复制和健康检查。安装前创建配置文件，确认 `disk_paths` 指向 Docker 数据实际所在文件系统（默认 `/var/lib/docker`）。Linux 主机安装每日北京时间 03:30 的任务及每小时检查：

```bash
sudo install -d -m 700 /etc/nutrigo
# 仅首次安装复制；保留已填写的异地存储和通知配置。
if ! sudo test -f /etc/nutrigo/backup.json; then
  sudo install -m 600 deploy/cloud/backup/operations.example.json /etc/nutrigo/backup.json
fi
sudo install -m 644 deploy/cloud/backup/nutrigo-backup.service /etc/systemd/system/
sudo install -m 644 deploy/cloud/backup/nutrigo-backup.timer /etc/systemd/system/
sudo install -m 644 deploy/cloud/backup/nutrigo-backup-check.service /etc/systemd/system/
sudo install -m 644 deploy/cloud/backup/nutrigo-backup-check.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nutrigo-backup.timer nutrigo-backup-check.timer
sudo systemctl start nutrigo-backup.service
sudo systemctl list-timers nutrigo-backup.timer nutrigo-backup-check.timer
sudo journalctl -u nutrigo-backup.service --since today
```

服务默认项目路径为 `/opt/nutrigo`；其他路径须修改两个 service 的 `WorkingDirectory`、`ExecStart` 脚本路径和 `--project` 参数。确认当前 Compose 项目名和现有持久卷一致，避免误备份新空卷。

可使用主机 Python 3.9+ 再次验证或隔离恢复，将示例路径替换为实际备份名：

```bash
python3 deploy/cloud/backup/backup.py verify backups/snapshot-实际备份名
python3 deploy/cloud/backup/backup.py restore backups/snapshot-实际备份名 --target restore-check/本次演练
```

恢复目标必须不存在，脚本拒绝覆盖任何现有目录。生成的 `backend/data.db`、`backend/uploads/` 和 `agent/agent.db` 可用于恢复演练。实际生产回滚前应停止写入、另行备份当前卷，再恢复选定版本；本命令不会自动覆盖生产数据。两个数据库分别取一致快照，不保证跨库同一时刻；需要这种保证时应暂停写入后备份。

### 检测、告警与异地备份接入

`/etc/nutrigo/backup.json` 默认为本地备份，`remote` 和 `alert_webhook` 留空时不会联网。定时编排使用该文件的 `keep`（默认 14）；Compose 单独运行仍使用 `.env` 的 `BACKUP_KEEP`。

- 每小时验证最新快照的哈希和数据库完整性，检查最近一次任务结果、快照是否超过 36 小时、磁盘是否不足 2 GiB 或使用率达到 90%。阈值可配置；备份前也检查磁盘。
- 结果保存在 `backups/maintenance-status.json`，异常退出码为 1，systemd 标记失败。健康检查不读取业务内容到日志。可通过 `journalctl -u nutrigo-backup.service -u nutrigo-backup-check.service` 查看。
- `alert_webhook` 可填接收 HTTPS JSON `{"text":"NutriGo backup: ..."}` 的通知入口。相同故障去重，恢复后通知一次；发送失败在下次检查重试，不跟随重定向。没有配置接收地址时，只有状态文件和 systemd 日志，不会主动通知手机。
- 主机安装 rclone，并把独立服务器/S3 等存储配置为命名 remote，凭据文件放在 `/etc/nutrigo/rclone.conf`（权限 600，禁止提交 Git）。将 `remote` 填为例如 `offsite:nutrigo-backups`，脚本使用 [copy --immutable](https://rclone.org/commands/rclone_copy/) 复制到每份快照的独立目录，再用 [check --download](https://rclone.org/commands/rclone_check/) 读回校验。校验失败不登记异地成功，也不清理旧本地备份；下次定时运行会备份并复制新的完整快照。失败快照保留本地，可按目录手动重传。
- 异地目标必须实际位于独立设备/存储，脚本无法判断 remote 是否仍指向本机。脚本不删除远端历史，需在存储端另设保留期并关注容量。可使用 rclone crypt remote 加密，恢复密钥另行保管。
- 手动完整运行：`sudo python3 deploy/cloud/backup/operations.py run --project /opt/nutrigo`；只检查：把 `run` 改为 `check`。已启用异地备份时，应使用编排入口，避免直接执行 Compose 本地备份绕过异地校验与保留策略。

截至本次核对，服务器已启用每日本机备份及每小时检测，`remote` 与 `alert_webhook` 仍为空，尚无异地副本或主动通知。异地复制只有配置真实存储并成功校验后才算启用，模板不会创建任何远程资源。远端快照下载后仍须执行 `backup.py verify` 和隔离 `restore`，再按停写恢复流程切换生产。模型、向量库、TLS 状态和部署密钥不包含在此用户数据备份中，需按各自恢复方式管理；整机故障也需要外部监控发现，本机检查不能在主机停机时运行。

## 启用已提供的 RAG 资料库

仓库 `agent/chroma_db/` 包含 `nutrition_textbook` 集合、2,277 条非空教材段落及 512 维 BGE 向量。数据库与 HNSW 文件必须来自同一份快照；复制前用 SQLite `PRAGMA integrity_check` 检查，并在副本上用与服务器相同版本的 ChromaDB 验证条数、向量和检索。ChromaDB 打开目录时可能更新内部状态，检查不要直接修改 Git 中的原始快照。

该集合使用 `BAAI/bge-small-zh-v1.5`，不能换成不同的嵌入模型。已验证模型版本为 `7999e1d3359715c523056ef9478215996d62a620`，`model.safetensors` 大小 95827648 字节，官方 SHA-256 为 `354763b9b1357bc9c44f62c6be2276321081ed2567773608c0d0785b61d5a026`。同时下载该版本的 tokenizer、配置、`modules.json` 和 `1_Pooling/config.json`；仅有权重文件不能正常加载。服务器无法访问模型站时，可从本机下载、校验后再传入 `model-data` 卷。

在已有部署上操作：

1. 运行用户数据备份，备份当前 `chroma-data` 卷、`.env` 和旧 Agent 镜像。
2. 将资料库解压到独立临时目录，与 Git 快照的文件哈希逐个核对。在临时容器使用该目录和本地 BGE 模型运行实际问题检索，确认相关段落命中，再切换生产。
3. 停止 Agent，完整复制数据库和索引到 Compose 现有 `chroma-data` 卷；不要只复制 SQLite 文件，也不要合并两份不同时刻的索引。
4. 设置 `RAG_ENABLED=true`，`RAG_MODEL_PATH` 填模型在容器中的绝对路径（例如 `/models/models--BAAI--bge-small-zh-v1.5/snapshots/7999e1d3359715c523056ef9478215996d62a620`）。绝对路径强制使用本地文件，不会在启动时联网下载。
5. 用原 Compose 项目更新 Agent：`docker compose --env-file deploy/cloud/.env -f deploy/cloud/compose.yml up -d --build --no-deps agent`。确认日志出现 `RAG 知识库已加载` 和正确文档数，再用真实聊天确认 `search_nutrition_knowledge` 返回教材段落；仅健康接口返回正常不代表 RAG 已初始化。

检索会对明确指定的维生素名称增加正文匹配条件，降低 C/D/E 等相近名称混淆；无匹配时返回未找到相关知识，不混用其他维生素的结果。知识库资料用于提供参考，不代表逐条内容已完成专业审校。此操作只更新云端服务，现有 App 即可使用，无需重新安装 APK。Git 快照和固定模型版本是知识库的恢复来源；用户数据库/照片的每日备份不包含模型和向量卷。

## 更新与验收顺序

1. 记录当前源码提交、镜像及 Compose 项目 / 卷名；保存服务器配置，并运行备份验证。已配置异地存储时使用 `operations.py run`，确保复制和读回成功。
2. 检查新代码对客户端和数据库的兼容性，在原 Compose 项目中更新 Go，再更新依赖它的 Agent。`AutoMigrate` 不是可逆的版本化迁移；回滚镜像前需判断是否同时恢复对应数据快照。
3. 检查 HTTPS 和两个服务的 ready，再使用专用账号验收登录、档案、日记、照片分析 / 批量保存和聊天工具；RAG 需实际问题检索。
4. 确认每日备份和每小时检测仍在运行，执行一次检测并查看退出状态和日志。健康探针、CI 和模型效果分别验收。

GitHub Actions 的 Android Release 只负责 APK 构建签名和发布，不自动部署这些服务。修改 API 源地址或客户端交互才需要相应的新 App 构建；文档更新不需要重建服务。
