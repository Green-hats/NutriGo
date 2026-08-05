"""
营养计算 + Agent 工具函数
"""
from recognition import db
from recognition.go_client import go_client


# ================================================================
# 营养计算（给前端用）
# ================================================================

async def calculate_intake(food_name: str, grams: float) -> dict:
    nutrition = await db.get_by_name(food_name)
    if not nutrition:
        return {"error": f"数据库中未找到「{food_name}」，请先添加营养数据"}

    scale = grams / 100.0
    return {
        "food_name": food_name,
        "grams": grams,
        "calories": round(nutrition["calories"] * scale, 1),
        "protein_g": round(nutrition["protein"] * scale, 1),
        "fat_g": round(nutrition["fat"] * scale, 1),
        "carbs_g": round(nutrition["carbohydrate"] * scale, 1),
        "per_100g": {
            "calories": nutrition["calories"],
            "protein_g": nutrition["protein"],
            "fat_g": nutrition["fat"],
            "carbs_g": nutrition["carbohydrate"],
        },
    }


# ================================================================
# Agent 工具函数
# ================================================================

async def lookup_food_nutrition(food_name: str) -> str:
    nutrition = await db.get_by_name(food_name)
    if not nutrition:
        candidates = await db.search(food_name, limit=3)
        if not candidates:
            return f"未找到「{food_name}」的营养数据"
        lines = ["未精确匹配，以下是相似结果（每100g）："]
        for c in candidates:
            lines.append(
                f"  {c['name']}：热量{c['calories']}kcal, "
                f"蛋白质{c['protein']}g, 脂肪{c['fat']}g, 碳水{c['carbohydrate']}g"
            )
        return "\n".join(lines)

    return (
        f"「{nutrition['name']}」每100g营养成分：\n"
        f"  热量：{nutrition['calories']} kcal\n"
        f"  蛋白质：{nutrition['protein']} g\n"
        f"  脂肪：{nutrition['fat']} g\n"
        f"  碳水化合物：{nutrition['carbohydrate']} g"
    )


async def get_user_profile(user_id: int) -> str:
    try:
        profile = await go_client.get_user_profile(user_id)
    except Exception as e:
        return f"获取用户档案失败：{e}"

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
    if profile.get("chronic_diseases"):
        disease_map = {
            "hypertension": "高血压", "diabetes": "糖尿病", "hyperlipidemia": "高血脂",
            "gout": "痛风", "heart_disease": "心脏病", "kidney_disease": "肾病",
            "digestive_disease": "消化系统疾病",
        }
        names = [disease_map.get(d, d) for d in profile["chronic_diseases"]]
        lines.append(f"  基础病：{', '.join(names)}")
    return "\n".join(lines)


async def get_diet_history(user_id: int, date: str, limit: int = 10) -> str:
    try:
        logs = await go_client.get_diet_logs(user_id, date)
    except Exception as e:
        return f"获取饮食记录失败：{e}"

    if not logs:
        return f"用户 {user_id} 在 {date} 没有饮食记录"

    total_cal = sum(log.get("calories", 0) for log in logs)
    lines = [f"用户 {user_id} 在 {date} 的饮食记录（共 {total_cal:.0f} kcal）："]
    shown = logs[:limit] if len(logs) > limit else logs
    for log in shown:
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
    if len(logs) > limit:
        lines.append(f"  ……共 {len(logs)} 条记录，其余 {len(logs) - limit} 条已省略")
    return "\n".join(lines)
