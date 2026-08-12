"""系统提示词完整性测试"""

from datetime import date

from app.config import settings

# 全部 5 个已注册工具名必须出现在提示词的工具路由规则中
ALL_TOOLS = [
    "lookup_food_nutrition",
    "get_user_profile",
    "get_diet_history",
    "get_diet_summary",
    "search_nutrition_knowledge",
]


def test_system_prompt_lists_all_tools():
    for name in ALL_TOOLS:
        assert name in settings.SYSTEM_PROMPT, f"提示词缺少工具规则: {name}"


def test_system_prompt_has_safety_boundary():
    assert "咨询医生" in settings.SYSTEM_PROMPT
    assert "拒绝" in settings.SYSTEM_PROMPT


def test_system_prompt_has_format_guidance():
    assert "Markdown" in settings.SYSTEM_PROMPT
    assert "不要重复调用同一个工具" in settings.SYSTEM_PROMPT


def test_system_prompt_replaces_today_date():
    # 原始模板保留占位符；渲染后替换为真实日期
    assert "TODAY_DATE" in settings.SYSTEM_PROMPT
    rendered = settings.system_prompt
    assert "TODAY_DATE" not in rendered
    assert date.today().isoformat() in rendered
