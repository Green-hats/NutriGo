# NutriGo 部署

> **说明**：本目录是作者个人的一套部署示例（前端节点 + 后端节点），供参考而非通用推荐。
> 实际部署请按自己的服务器数量、地域、资源配置调整，不一定需要两台机器——
> 单机跑全部服务、或用 K8s/云托管等完全不同的方案都可行。

本方案为：**后端节点跑 backend + agent（Docker Compose）**，**前端节点跑静态站点 + Caddy 反代（自动 HTTPS）**。两个节点可以是同一台或不同的服务器。

```
前端节点 (Caddy 自动 HTTPS)              后端节点 (Docker)
<your-domain>                            backend :3333 (Go+SQLite)
 ├── /          静态前端                  agent   :8000 (FastAPI+CLIP)
 ├── /api       → <backend-ip>:3333
 └── /agent-api → <backend-ip>:8000
```

架构细节见 [docs/architecture.md](docs/architecture.md)。

## 目录结构

```
deploy/
├── compose/
│   ├── docker-compose.yml        # 后端节点编排 (backend + agent)
│   ├── Dockerfile.backend        # Go 多阶段构建
│   ├── Dockerfile.agent          # Python + torch-cpu + CLIP + bge
│   └── .env.production.example   # 生产环境变量模板
├── caddy/
│   └── Caddyfile                 # 前端节点反代配置（模板）
├── scripts/
│   ├── setup-server.sh           # 后端节点: 装 Docker + swap
│   ├── build-frontend.sh         # 本地: 构建前端 dist
│   └── deploy-frontend.sh              # 本地: 部署前端到前端节点 + reload Caddy
└── docs/
    └── architecture.md           # 架构与请求闭环
```

## 一、后端节点（backend + agent）

### 1. 初始化

```bash
sudo bash deploy/scripts/setup-server.sh
```

脚本会安装 Docker Engine + compose 插件并创建 swap（低配机器防 OOM）。

### 2. 开放端口

安全组/防火墙放行 **3333** 与 **8000**（供前端节点 Caddy 反代）。

### 3. 配置环境变量

```bash
cd deploy/compose
cp .env.production.example .env
# 编辑 .env：
#   JWT_SECRET / INTERNAL_TOKEN  → openssl rand -hex 32 生成
#   LLM_API_KEY                  → 你的 DeepSeek/OpenAI key
#   CORS_ORIGINS                 → https://<your-domain>
```

### 4. 启动

```bash
cd <NutriGo仓库根目录>
docker compose -f deploy/compose/docker-compose.yml up -d --build
```

### 5. 验证

```bash
curl http://localhost:3333/api/health        # {"status":"healthy"}
curl http://localhost:8000/api/health
```

> 首次构建会预下载模型（CLIP ~400MB + bge ~100MB），需等待几分钟。

## 二、前端节点（静态站点 + Caddy）

### 1. 安装 Caddy

```bash
# Debian/Ubuntu
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy
```

### 2. 配置 Caddy

编辑 `/etc/caddy/Caddyfile`，参考 `deploy/caddy/Caddyfile`：把 `<your-domain>` 换成你的域名、`<backend-ip>` 换成后端节点公网 IP：

```
<your-domain> {
	encode gzip
	root * /srv/nutrigo
	try_files {path} /index.html
	file_server

	handle /api/* {
		reverse_proxy <backend-ip>:3333
	}
	handle /agent-api/* {
		reverse_proxy <backend-ip>:8000 {
			flush_interval -1
		}
	}
}
```

```bash
sudo systemctl reload caddy
```

### 3. 部署前端

在**开发机**上执行（会自动构建 + scp 到前端节点）：

```bash
# 先编辑 deploy/scripts/deploy-frontend.sh 配置主机 IP 等变量
bash deploy/scripts/deploy-frontend.sh
```

或手动：

```bash
bash deploy/scripts/build-frontend.sh        # 产出 deploy/dist
scp -r deploy/dist/* root@<frontend-ip>:/srv/nutrigo/
```

## 三、端到端验证

| 检查项 | 命令 |
|---|---|
| 前端可访问 | `curl -I https://<your-domain>` |
| backend 反代 | `curl https://<your-domain>/api/health` |
| agent 反代 | `curl https://<your-domain>/agent-api/api/health` |
| 注册 | `curl -X POST https://<your-domain>/api/auth/register ...` |

浏览器打开 `https://<your-domain>`：注册 → 登录 → 上传食物图识别 → AI 对话 → 饮食统计。

## 开发工具

| 脚本 | 用途 |
|------|------|
| `scripts/capture-demo.mjs` | 用 Playwright 自动生成 README 演示截图与 GIF（`docs/screenshots/`） |

```bash
node deploy/scripts/capture-demo.mjs
# 需先启动三端，并安装 playwright + firefox + ffmpeg；详见脚本头部注释
```

## 常见问题

**Q: 模型下载超时？**
构建时预下载依赖外网，可设置镜像：`export HF_ENDPOINT=https://hf-mirror.com` 后重新构建。

**Q: 识别很慢？**
`agent/recognition/multimodal.py` 已做文本向量预计算 + int8 量化 + 线程限制。低配 CPU（如 2C4G）下单张约 2-3s。

**Q: 内存不足？**
确认 `setup-server.sh` 已创建 swap：`swapon --show`。

**Q: 想用本地 Ollama 替代外部 API？**
加 ollama 服务，`LLM_MODEL=ollama/qwen2.5`、`LLM_BASE_URL=http://ollama:11434`。需 4G+ 内存，CPU 推理会变慢。
