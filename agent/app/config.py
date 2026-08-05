"""
全局配置 — 从 .env 文件读取所有运行参数

创建 agent/.env 文件，填入你的 API Key：
  LLM_MODEL=gemini/gemini-2.0-flash    # litellm 格式：provider/model
  LLM_API_KEY=your-key-here
  GO_BACKEND_URL=http://localhost:3333
  INTERNAL_TOKEN=nutri-go-internal-token-dev

不填 .env 也可以启动，会用代码里的默认值（仅限本地开发）。
"""

import os

from dotenv import load_dotenv

# 把项目根目录下的 .env 加载到环境变量
load_dotenv()


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
    INTERNAL_TOKEN: str = os.getenv("INTERNAL_TOKEN", "nutri-go-internal-token-dev")

    # --- JWT 鉴权 ---
    # 与 Go 后端 internal/config/jwt.go 中的 JWTSecret 保持一致
    JWT_SECRET: str = os.getenv("JWT_SECRET", "nutri-go-secret-key-change-in-production")

    # --- 数据库 ---
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "agent.db")

    # --- Agent 行为 ---
    MAX_AGENT_ITERATIONS: int = int(os.getenv("MAX_AGENT_ITERATIONS", "15"))
    LLM_TIMEOUT: int = int(os.getenv("LLM_TIMEOUT", "120"))  # 单次 LLM 调用超时(秒)，网络抖动时自动重试
    SYSTEM_PROMPT: str = """你是 NutriGo 智能营养师，专为中国用户提供饮食营养指导。

你的职责：
1. 分析用户的饮食记录，给出营养评估和改进建议
2. 根据用户的健康档案（身高、体重、目标、过敏原）提供个性化食谱
3. 回答营养学相关问题，引用《中国居民膳食指南》等权威知识
4. 根据食物图片识别结果，告诉用户该食物的营养信息

规则：
- 使用中文回复
- 回答简洁专业，用数据说话
- 涉及营养数据时，标注单位（克、千卡等）
- 给出建议时，结合用户的实际档案信息
- 今天的日期是 TODAY_DATE，查询饮食记录时使用 YYYY-MM-DD 格式
- **重要：拿到工具返回的结果后，必须直接生成最终回复，不要重复调用同一个工具**"""

    @property
    def system_prompt(self) -> str:
        from datetime import date
        return self.SYSTEM_PROMPT.replace("TODAY_DATE", date.today().isoformat())


# 全局单例，其他模块 import 这个就行
settings = Config()
