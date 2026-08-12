# 🥗 NutriGo — AI Nutrition Assistant

<div align="center">

[**English**](README.md) · [简体中文](README.zh-CN.md)

</div>

> Snap a photo of your food, let AI analyze the nutrition, and get personalized dietary advice. A fully-featured full-stack AI nutrition assistant.

[![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go)](backend/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python)](agent/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](frontend/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript)](frontend/)
[![License](https://img.shields.io/github/license/Green-hats/NutriGo?logo=gnu)](LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/Green-hats/NutriGo/ci.yml?branch=main&logo=github&label=CI)](https://github.com/Green-hats/NutriGo/actions)
[![Release](https://img.shields.io/github/v/release/Green-hats/NutriGo?logo=github&label=Release)](https://github.com/Green-hats/NutriGo/releases)
[![Last Commit](https://img.shields.io/github/last-commit/Green-hats/NutriGo?logo=git&label=Last%20commit)](https://github.com/Green-hats/NutriGo)

---

## ✨ Features

- **📷 Photo Recognition** — Zero-shot food recognition with Chinese-CLIP, Top-5 candidates, 510+ home-cooked dishes
- **🤖 AI Chat** — Agent Loop + 5 tools, SSE streaming output, Markdown + chain-of-thought rendering
- **📚 RAG Knowledge Base** — ChromaDB with 2,277 entries from a nutrition textbook, answers professional nutrition questions
- **📊 Nutrition Analysis** — 8,407 real nutrition data points, precise gram-based calculation, multi-day trend insights
- **🗓️ Food Diary** — Record meals by date, nutrition trends visualized with recharts bar charts
- **👤 Personalized Profile** — Height/weight, goals, allergies, pre-existing conditions; AI-tailored dietary advice
- **🛡️ Enterprise-grade Security** — JWT + refresh-token rotation & logout blacklist, IP rate limiting on auth, internal service token, strict key validation in production

---

## 🚀 Quick Start

### Requirements

| Tool | Version |
|------|---------|
| Go | 1.26+ |
| Python | 3.13+ |
| Node.js | 22+ |
| uv | 0.11+ |

### Installation

```bash
git clone https://github.com/Green-hats/NutriGo.git
cd NutriGo

# Configure LLM API key (supports OpenAI/Gemini/DeepSeek/Ollama via litellm)
cp agent/.env.example agent/.env
# Edit agent/.env and fill in LLM_API_KEY

# Start all services with one command
./start.sh
```

Open **http://localhost:5173** in your browser 🎉

### Service Layout

| Service | Port | Stack | Responsibility |
|---------|------|-------|----------------|
| `frontend` | :5173 | React 19 + TS + TailwindCSS | User interface |
| `backend` | :3333 | Go + Gin + GORM + SQLite | Users / data / files |
| `agent` | :8000 | FastAPI + litellm + ChromaDB | AI chat / recognition / RAG |

---

## 🏗️ Architecture

```
┌─────────────┐  REST / JWT   ┌──────────────┐
│  Frontend   │ ────────────► │   Backend    │
│  React 19   │ ◄──────────── │  Go + Gin    │
└─────┬───────┘               │    :3333     │
      │                       │  SQLite · JWT│
      │                       └───────▲───────┘
      │ SSE chat / REST recognition    │ REST (Internal Token)
      ▼                               │
┌─────┬───────────────────────────────┬─────────────────────┐
│                   Agent · FastAPI :8000                   │
│                  Agent Loop: 5 tools + LLM                 │
│                    + RAG (ChromaDB) + CLIP                 │
└───────────────────────────────────────────────────────────┘
```

- **Agent Loop** — the LLM autonomously decides which tool to call; streams chain-of-thought (`reasoning_content`)
- **5 Tools** — look up nutrition / get profile / get diet history / get nutrition trends / search knowledge base
- **RAG** — BGE-small-zh embeddings + ChromaDB vector retrieval
- **Multimodal** — zero-shot food recognition with Chinese-CLIP

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detailed design.

---

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System architecture, data flow, security design |
| [API Reference](backend/API.md) | All Go backend endpoints |
| [Agent Doc](docs/agent.md) | Python Agent design & tool descriptions |
| [Frontend Doc](docs/frontend.md) | React frontend structure |
| [Test Prompts](docs/agent-test-prompts.md) | Agent test prompt suites |

---

## 🧪 Testing

```bash
# Unit tests (no services required, CI-friendly)
make test-go-unit        # Go: 75 cases
make test-frontend       # Frontend vitest: 34 cases (store + component)
make test-agent-unit     # Agent pytest: 63 cases (no LLM / models)

# Integration tests (services must be running)
make test-backend        # Go backend: 67 cases
make test-agent          # Agent basics: 20 cases
make test-identify       # Image recognition: 13 cases
make test-prompts        # Full prompts: --quick 9 core cases

# Run everything
make test
```

**Static analysis:** `make lint` (ruff + mypy + oxlint) · `make typecheck` (mypy type checking)

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 · TypeScript (strict) · TailwindCSS · Zustand · Vite · vitest |
| Agent | Python 3.13 · FastAPI · litellm · Chinese-CLIP · ChromaDB · SSE |
| Backend | Go 1.26 · Gin · GORM · SQLite · JWT · bcrypt |
| Quality | Go test · pytest · ruff · mypy · oxlint · vitest · GitHub Actions CI |

---

## 🚀 Deployment

See [`deploy/`](deploy/README.md) for a deployment example (author's personal setup, not a universal recommendation):

- **Frontend node** — static hosting + Caddy reverse proxy with automatic HTTPS
- **Backend node** — backend + agent orchestrated with Docker Compose
- Image recognition is CPU-optimized (precomputed text vectors + int8 quantization, ~2–3s per image)

```
Frontend (Caddy)                  Backend (Docker)
 /  static frontend               backend :3333
 /api       → :3333               agent   :8000
 /agent-api → :8000                └─ litellm → LLM API
```

---

## 🤝 Contributing

Contributions are welcome! Please check out:

- [Contributing Guide](CONTRIBUTING.md)
- Run `make lint && make test` before submitting
- Follow the Conventional Commits convention

## 📄 License

This project is open-sourced under the [GPL v3](LICENSE) license.

---

*NutriGo — giving everyone their own AI nutritionist.*
