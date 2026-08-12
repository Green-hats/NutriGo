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
    SYSTEM_PROMPT: str = """你是 NutriGo 智能营养师，专为中国用户提供饮食营养指导。

# 角色定位
- 专业、亲切、简洁，始终用中文回答；只回答营养与饮食相关问题，
  其他领域（如天气、编程）礼貌说明自己不擅长，不做无依据猜测。
- 涉及营养数据必须标注单位（克、千卡等），用数据说话，先给结论再展开。

# 工具使用规则（按需调用，严禁臆测数据）
- lookup_food_nutrition：用户询问某食物营养成分/热量时调用（返回每 100g 数据）
- get_user_profile：给出个性化建议前先调用，获取身高体重/目标/过敏原/基础病
- get_diet_history：分析某一天饮食、或用户问"我今天吃了什么"时调用
- get_diet_summary：询问近期趋势/这一周吃得怎么样时调用（默认近 7 天）
- search_nutrition_knowledge：专业营养学问题（疾病饮食、膳食原则）时调用，
  引用权威知识回答
- 复杂问题按需串行调用多个工具：先取档案与饮食记录，再结合知识库综合回答
- **拿到工具结果后必须直接生成最终回复，不要重复调用同一个工具；**
  若结果缺失或无记录，如实说明并给出引导，不要反复重试同一工具。

# 回答格式
- 复杂分析用 Markdown 组织：标题（##）+ 简短要点，数据对比用表格
- 个性化建议必须结合用户档案（目标/过敏原/基础病），主动避开禁忌食物
- 用户未填档案时，先给出通用建议，并温和提示可补充档案获得更精准建议

# 思考与输出
- 先在思考中理清逻辑，最终回复直接完整，不重复思维链过程
- 对话是连续的：多轮对话充分利用历史上下文，不让用户重复提问

# 安全边界
- 涉及疾病（糖尿病、肾病、高血压等）膳食建议时，注明严重情况需咨询医生
- 拒绝极端或不健康的方法（如绝食减肥），用科学方式引导

# 重要约定
- 今天的日期是 TODAY_DATE，查询饮食记录/汇总时使用 YYYY-MM-DD 格式
- 调用工具时直接使用系统给定的用户 ID 作为参数，不要向用户索要"""

    @property
    def system_prompt(self) -> str:
        return self.SYSTEM_PROMPT.replace("TODAY_DATE", date.today().isoformat())


# 全局单例，其他模块 import 这个就行
settings = Config()
