# NutriGo 部署

本目录提供 NutriGo 的完整可部署方案：**国内 Debian 服务器跑 backend + agent（Docker）**，**香港服务器跑前端 + Caddy 反代**。

```
香港 (Caddy 自动 HTTPS)              国内 (Docker + swap)
nutrigo.greenhats.dev                backend :3333 (Go+SQLite)
 ├── /          静态前端              agent   :8000 (FastAPI+CLIP)
 ├── /api       → 国内:3333
 └── /agent-api → 国内:8000
```

架构细节见 [docs/architecture.md](docs/architecture.md)。

## 目录结构

```
deploy/
├── compose/
│   ├── docker-compose.yml        # 国内服务器编排 (backend + agent)
│   ├── Dockerfile.backend        # Go 多阶段构建
│   ├── Dockerfile.agent          # Python + torch-cpu + CLIP + bge
│   └── .env.production.example   # 生产环境变量模板
├── caddy/
│   └── Caddyfile                 # 香港服务器反代配置
├── scripts/
│   ├── setup-server.sh           # 国内: 装 Docker + 4G swap
│   ├── build-frontend.sh         # 本地: 构建前端 dist
│   └── deploy-hk.sh              # 本地: 部署前端到香港 + reload
└── docs/
    └── architecture.md           # 架构与请求闭环
```

## 一、国内 Debian 服务器（backend + agent）

### 1. 初始化

```bash
sudo bash deploy/scripts/setup-server.sh
```

脚本会安装 Docker Engine + compose 插件并创建 4G swap。

### 2. 开放端口

安全组/防火墙放行 **3333** 与 **8000**（供香港 Caddy 反代）。

### 3. 配置环境变量

```bash
cd deploy/compose
cp .env.production.example .env
# 编辑 .env：
#   JWT_SECRET / INTERNAL_TOKEN  → openssl rand -hex 32 生成
#   LLM_API_KEY                  → 你的 DeepSeek/OpenAI key
#   CORS_ORIGINS                 → https://nutrigo.greenhats.dev
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

## 二、香港服务器（前端 + Caddy）

### 1. 安装 Caddy

```bash
# Debian/Ubuntu
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy
```

### 2. 配置 Caddy

编辑 `/etc/caddy/Caddyfile`，参考 `deploy/caddy/Caddyfile`，把 `国内服务器IP` 替换成国内服务器公网 IP：

```
nutrigo.greenhats.dev {
	encode gzip
	root * /srv/nutrigo
	try_files {path} /index.html
	file_server

	handle /api/* {
		reverse_proxy 国内服务器IP:3333
	}
	handle /agent-api/* {
		reverse_proxy 国内服务器IP:8000 {
			flush_interval -1
		}
	}
}
```

```bash
sudo systemctl reload caddy
```

### 3. 部署前端

在**开发机**上执行（会自动构建 + scp 到香港）：

```bash
# 先编辑 deploy/scripts/deploy-hk.sh 配置 HK_HOST（香港 IP）等变量
bash deploy/scripts/deploy-hk.sh
```

或手动：

```bash
bash deploy/scripts/build-frontend.sh        # 产出 deploy/dist
scp -r deploy/dist/* root@香港IP:/srv/nutrigo/
```

## 三、端到端验证

| 检查项 | 命令 |
|---|---|
| 前端可访问 | `curl -I https://nutrigo.greenhats.dev` |
| backend 反代 | `curl https://nutrigo.greenhats.dev/api/health` |
| agent 反代 | `curl https://nutrigo.greenhats.dev/agent-api/api/health` |
| 注册 | `curl -X POST https://nutrigo.greenhats.dev/api/auth/register ...` |

浏览器打开 `https://nutrigo.greenhats.dev`：注册 → 登录 → 上传食物图识别 → AI 对话 → 饮食统计。

## 常见问题

**Q: 模型下载超时？**
构建时预下载依赖外网，可在国内服务器设置镜像：`export HF_ENDPOINT=https://hf-mirror.com` 后重新构建。

**Q: 识别很慢？**
`agent/recognition/multimodal.py` 已做文本向量预计算 + int8 量化 + 线程限制。2C4G 下单张约 2-3s。

**Q: 内存不足？**
确认 `setup-server.sh` 已创建 4G swap：`swapon --show`。

**Q: 想用本地 Ollama 替代外部 API？**
加 ollama 服务，`LLM_MODEL=ollama/qwen2.5`、`LLM_BASE_URL=http://ollama:11434`。需 4G+ 内存，CPU 推理会变慢。
