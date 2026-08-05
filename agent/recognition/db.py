"""
foods_simple.db — 食物营养数据库（8407 条数据）

表: foods
列: name, category, calories, protein, fat, carbohydrate, fiber

份量通过 category 推断，无单独的 food_portion 表。
"""

import aiosqlite

DB_PATH = "nutrition.db"

CATEGORY_DEFAULTS = {
    "川菜": (350, "份"), "广东菜": (300, "份"), "甘肃菜": (300, "份"),
    "家常菜": (300, "份"), "东北菜": (350, "份"), "湖南菜": (300, "份"),
    "江苏菜": (300, "份"), "浙江菜": (300, "份"), "福建菜": (300, "份"),
    "山东菜": (350, "份"), "安徽菜": (300, "份"),
    "主食": (250, "碗"), "小吃": (200, "份"),
    "肉类": (200, "份"), "蔬菜": (250, "份"),
    "水果": (200, "个"), "饮品": (250, "杯"), "饮料": (250, "杯"),
    "蛋类": (60, "个"), "豆制品": (300, "份"),
    "汤类": (400, "碗"), "水产": (250, "份"),
    "零食、点心、冷饮": (100, "份"), "点心、零食、冷饮": (100, "份"),
    "烘烤、方便食品": (150, "份"),
}
FALLBACK_PORTION = (300, "份")


async def init_db() -> None:
    pass  # 数据库已存在，无需建表


async def seed_data() -> None:
    pass  # 数据库已预填充，无需种子数据


async def search(food_name: str, limit: int = 5) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT name, category, calories, protein, fat, carbohydrate, fiber, "
            "CASE WHEN name = ? THEN 0 ELSE 1 END AS sort_order "
            "FROM foods WHERE name LIKE ? "
            "ORDER BY sort_order, name LIMIT ?",
            (food_name, f"%{food_name}%", limit),
        )
        return [dict(row) for row in await cursor.fetchall()]


async def get_by_name(food_name: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT name, category, calories, protein, fat, carbohydrate, fiber "
            "FROM foods WHERE name = ?", (food_name,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_portion(food_name: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT category FROM foods WHERE name = ?", (food_name,)
        )
        row = await cursor.fetchone()
        if row and row["category"] in CATEGORY_DEFAULTS:
            g, u = CATEGORY_DEFAULTS[row["category"]]
            return {"grams": g, "unit": u}
        # 模糊匹配 category
        if row:
            cat = row["category"]
            for key, (g, u) in CATEGORY_DEFAULTS.items():
                if key in cat:
                    return {"grams": g, "unit": u}
        return {"grams": FALLBACK_PORTION[0], "unit": FALLBACK_PORTION[1]}


async def list_names(category: str = "") -> list[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        if category:
            cursor = await db.execute(
                "SELECT name FROM foods WHERE category = ? ORDER BY name",
                (category,)
            )
        else:
            cursor = await db.execute("SELECT name FROM foods ORDER BY name")
        return [row[0] for row in await cursor.fetchall()]
