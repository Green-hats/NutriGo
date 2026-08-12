"""
全局配置 — 从 .env 文件读取所有运行参数

创建 agent/.env 文件，填入你的 API Key：
  LLM_MODEL=gemini/gemini-2.0-flash    # litellm 格式：provider/model
  LLM_API_KEY=your-key-here
  GO_BACKEND_URL=http://localhost:3333
  INTERNAL_TOKEN=nutri-go-internal-token-dev

不填 .env 也可以启动，会用代码里的默认值（仅限本地开发）。
生产环境（APP_ENV=production）强制要求 JWT_SECRET / INTERNAL_TOKEN 从环境变量注入。
"""

import os
from datetime import date

from dotenv import load_dotenv

from app.system_prompt import SYSTEM_PROMPT as _SYSTEM_PROMPT

# 把项目根目录下的 .env 加载到环境变量
load_dotenv()

# 开发环境默认值（仅当 APP_ENV != production 时允许使用）
DEV_JWT_SECRET = "nutri-go-secret-key-change-in-production"
DEV_INTERNAL_TOKEN = "nutri-go-internal-token-dev"


def is_production() -> bool:
    return os.getenv("APP_ENV") == "production"


def _require_secret(name: str, value: str, dev_default: str) -> str:
    """生产环境强制从环境变量注入密钥，开发环境允许默认值"""
    if is_production():
        if not value or value == dev_default:
            raise RuntimeError(
                f"生产环境必须通过环境变量 {name} 设置强随机密钥，禁止使用默认值"
            )
    return value or dev_default


class Config:
    """单例配置，所有模块通过 `from config import settings` 使用"""

    # --- LLM 配置 ---
    # litellm 模型标识：格式为 "provider/model"，例如：
    #   gemini/gemini-2.0-flash     (Google Gemini)
    #   openai/gpt-4o-mini          (OpenAI)
    #   deepseek/deepseek-chat      (DeepSeek)
    #   ollama/qwen2.5              (本地 Ollama)
    LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek/deepseek-v4-flash")  # 默认使用 DeepSeek V4 Flash
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "")  # 本地代理/Ollama 时设置

    # --- Go 后端地址 ---
    GO_BACKEND_URL: str = os.getenv("GO_BACKEND_URL", "http://localhost:3333")
    # 生产环境强制要求注入，禁止使用默认值
    INTERNAL_TOKEN: str = _require_secret(
        "INTERNAL_TOKEN", os.getenv("INTERNAL_TOKEN", ""), DEV_INTERNAL_TOKEN
    )

    # --- JWT 鉴权 ---
    # 与 Go 后端 internal/config/jwt.go 中的 JWTSecret 保持一致
    JWT_SECRET: str = _require_secret("JWT_SECRET", os.getenv("JWT_SECRET", ""), DEV_JWT_SECRET)

    # --- 数据库 ---
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "agent.db")

    # --- CORS ---
    # 逗号分隔的允许跨域来源，默认本地前端；生产改为正式域名
    CORS_ORIGINS: list[str] = [
        o.strip() for o in
        os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if o.strip()
    ]

    # --- Agent 行为 ---
    MAX_AGENT_ITERATIONS: int = int(os.getenv("MAX_AGENT_ITERATIONS", "15"))
    LLM_TIMEOUT: int = int(os.getenv("LLM_TIMEOUT", "120"))  # 单次 LLM 超时(秒)，网络抖动自动重试
    # 工具结果超长兜底截断阈值(字符)
    TOOL_RESULT_MAX_CHARS: int = int(os.getenv("TOOL_RESULT_MAX_CHARS", "2000"))
    MAX_CONTEXT_TOKENS: int = int(os.getenv("MAX_CONTEXT_TOKENS", "8000"))  # 发给 LLM 的上下文 token 预算
    MAX_CONTEXT_MESSAGES: int = int(os.getenv("MAX_CONTEXT_MESSAGES", "40"))  # 发给 LLM 的最大消息条数
    TOOL_TIMEOUT: int = int(os.getenv("TOOL_TIMEOUT", "30"))  # 单个工具执行超时(秒)
    MAX_ACTIVE_PER_USER: int = int(os.getenv("MAX_ACTIVE_PER_USER", "1"))  # 同一用户同时最多 N 个活跃对话
    MAX_MESSAGE_LENGTH: int = int(os.getenv("MAX_MESSAGE_LENGTH", "2000"))  # 单条用户消息最大字符数
    SYSTEM_PROMPT: str = _SYSTEM_PROMPT

    @property
    def system_prompt(self) -> str:
        return self.SYSTEM_PROMPT.replace("TODAY_DATE", date.today().isoformat())


# 全局单例，其他模块 import 这个就行
settings = Config()
