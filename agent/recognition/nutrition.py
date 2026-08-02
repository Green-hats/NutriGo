"""
营养计算 + Agent 工具函数

两层职责：
  1. calculate_intake() — 前端或 identify-food 路由直接调用，按克数换算实际营养
  2. Agent 工具函数 — 给 tools.py 注册，Agent Loop 中 LLM 可以通过 tool_call 调用
"""

from recognition import db
from recognition.go_client import go_client


# ================================================================
# 营养计算（给前端用）
# ================================================================

async def calculate_intake(food_name: str, grams: float) -> dict:
    """
    用户输入克数 → 查询 nutrition.db → 按比例计算实际摄入营养

    返回：
      {food_name, grams, calories, protein_g, fat_g, carbs_g,
       per_100g: {calories, protein_g, fat_g, carbs_g}}
    或 {error: "..."} 如果菜单不存在
    """
    nutrition = await db.get_by_name(food_name)
    if not nutrition:
        return {"error": f"数据库中未找到「{food_name}」，请先添加营养数据"}

    scale = grams / 100.0
    return {
        "food_name": food_name,
        "grams": grams,
        "calories": round(nutrition["calories"] * scale, 1),
        "protein_g": round(nutrition["protein_g"] * scale, 1),
        "fat_g": round(nutrition["fat_g"] * scale, 1),
        "carbs_g": round(nutrition["carbs_g"] * scale, 1),
        "per_100g": {
            "calories": nutrition["calories"],
            "protein_g": nutrition["protein_g"],
            "fat_g": nutrition["fat_g"],
            "carbs_g": nutrition["carbs_g"],
        },
    }


# ================================================================
# Agent 工具函数（LLM 通过 tool_call 调用）
# 返回字符串，LLM 直接阅读
# ================================================================

async def lookup_food_nutrition(food_name: str) -> str:
    """
    查食物每 100g 的营养成分。
    LLM 用这个工具获取精确营养数据。
    """
    nutrition = await db.get_by_name(food_name)
    if not nutrition:
        # 模糊搜索兜底
        candidates = await db.search(food_name, limit=3)
        if not candidates:
            return f"未找到「{food_name}」的营养数据"
        lines = ["未精确匹配，以下是相似结果（每100g）："]
        for c in candidates:
            lines.append(
                f"  {c['food_name']}：热量{c['calories']}kcal, "
                f"蛋白质{c['protein_g']}g, 脂肪{c['fat_g']}g, 碳水{c['carbs_g']}g"
            )
        return "\n".join(lines)

    return (
        f"「{nutrition['food_name']}」每100g营养成分：\n"
        f"  热量：{nutrition['calories']} kcal\n"
        f"  蛋白质：{nutrition['protein_g']} g\n"
        f"  脂肪：{nutrition['fat_g']} g\n"
        f"  碳水化合物：{nutrition['carbs_g']} g"
    )


async def get_user_profile(user_id: int) -> str:
    """
    从 Go 后端获取用户健康档案。
    LLM 用这个工具了解用户的过敏原、目标等，给出个性化建议。
    """
    try:
        profile = await go_client.get_user_profile(user_id)
    except Exception as e:
        return f"获取用户档案失败：{e}"

    # 如果全是默认值说明没填
    if not profile.get("height_cm") and not profile.get("weight_kg"):
        return "该用户尚未填写健康档案"

    lines = [f"用户ID {user_id} 的健康档案："]
    if profile.get("height_cm"):
        lines.append(f"  身高：{profile['height_cm']} cm")
    if profile.get("weight_kg"):
        lines.append(f"  体重：{profile['weight_kg']} kg")
    if profile.get("age"):
        lines.append(f"  年龄：{profile['age']} 岁")
    if profile.get("gender"):
        lines.append(f"  性别：{profile['gender']}")
    if profile.get("goal"):
        goal_map = {"lose_weight": "减重", "maintain": "维持体重", "gain_muscle": "增肌"}
        lines.append(f"  目标：{goal_map.get(profile['goal'], profile['goal'])}")
    if profile.get("allergies"):
        lines.append(f"  过敏原：{', '.join(profile['allergies'])}")
    if profile.get("dietary_habits"):
        lines.append(f"  饮食习惯：{', '.join(profile['dietary_habits'])}")
    return "\n".join(lines)


async def get_diet_history(user_id: int, date: str) -> str:
    """
    从 Go 后端获取用户某天的饮食记录。
    LLM 用这个工具了解用户已经吃了什么，给出针对建议。
    """
    try:
        logs = await go_client.get_diet_logs(user_id, date)
    except Exception as e:
        return f"获取饮食记录失败：{e}"

    if not logs:
        return f"用户 {user_id} 在 {date} 没有饮食记录"

    total_cal = sum(log.get("calories", 0) for log in logs)
    lines = [f"用户 {user_id} 在 {date} 的饮食记录（共 {total_cal:.0f} kcal）："]
    for log in logs:
        meal = log.get("meal_type", "未知")
        meal_cn = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "snack": "加餐"}
        lines.append(
            f"  [{meal_cn.get(meal, meal)}] {log.get('food_name')} "
            f"({log.get('portion', '')}) — "
            f"{log.get('calories', 0):.0f}kcal "
            f"(蛋白质{log.get('protein_g', 0):.0f}g "
            f"脂肪{log.get('fat_g', 0):.0f}g "
            f"碳水{log.get('carbs_g', 0):.0f}g)"
        )
    return "\n".join(lines)
