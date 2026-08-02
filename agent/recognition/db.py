"""
nutrition.db — 食物营养数据库（独立于 agent.db）

两张表：
  food_nutrition  — 每 100g 的营养成分
  food_portion    — 默认每份克数

用法：
  from recognition.db import init_db, seed_data, search, get_by_name, get_portion, list_names

首次启动时 seed_data() 插入 30+ 条种子数据，后续可通过 SQL 手动扩充。
"""

import aiosqlite
from typing import Optional

DB_PATH = "nutrition.db"


# ================================================================
# 建表
# ================================================================

async def init_db() -> None:
    """创建 nutrition.db 的两张表（不插入数据）"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS food_nutrition (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                food_name  TEXT NOT NULL UNIQUE,
                category   TEXT DEFAULT '',
                calories   REAL DEFAULT 0,
                protein_g  REAL DEFAULT 0,
                fat_g      REAL DEFAULT 0,
                carbs_g    REAL DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS food_portion (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                food_name  TEXT NOT NULL UNIQUE,
                default_g  INTEGER NOT NULL,
                unit       TEXT DEFAULT '份'
            )
        """)
        await db.commit()


# ================================================================
# 种子数据（每 100g）
# ================================================================

SEED_NUTRITION = [
    # 川菜
    ("宫保鸡丁", "川菜", 167, 14.2, 10.5, 5.8),
    ("麻婆豆腐", "川菜", 128, 8.5, 9.2, 4.1),
    ("回锅肉", "川菜", 220, 12.0, 18.0, 5.0),
    ("水煮鱼", "川菜", 135, 15.3, 7.8, 1.2),
    ("夫妻肺片", "川菜", 185, 14.0, 13.5, 2.0),

    # 家常菜
    ("番茄炒蛋", "家常菜", 87, 4.8, 5.2, 5.3),
    ("红烧肉", "家常菜", 290, 8.5, 25.0, 8.0),
    ("青椒肉丝", "家常菜", 120, 10.0, 7.5, 4.0),
    ("可乐鸡翅", "家常菜", 210, 16.0, 12.0, 10.0),
    ("醋溜白菜", "家常菜", 45, 1.5, 2.5, 4.5),

    # 主食
    ("米饭", "主食", 116, 2.6, 0.3, 25.9),
    ("蛋炒饭", "主食", 185, 5.3, 7.2, 25.6),
    ("馒头", "主食", 223, 7.0, 1.1, 44.2),
    ("面条", "主食", 110, 3.8, 0.5, 22.0),
    ("小米粥", "主食", 46, 1.4, 0.7, 8.4),

    # 小吃
    ("饺子", "小吃", 220, 8.0, 9.0, 28.0),
    ("馄饨", "小吃", 195, 7.5, 7.0, 26.0),
    ("春卷", "小吃", 280, 6.0, 15.0, 30.0),

    # 蔬菜
    ("炒青菜", "蔬菜", 42, 2.0, 2.5, 3.0),
    ("西兰花", "蔬菜", 34, 2.8, 0.4, 6.6),
    ("番茄", "蔬菜", 18, 0.9, 0.2, 3.9),
    ("胡萝卜", "蔬菜", 41, 0.9, 0.2, 9.6),

    # 肉类
    ("鸡胸肉", "肉类", 165, 31.0, 3.6, 0.0),
    ("牛肉", "肉类", 250, 26.0, 15.0, 0.0),
    ("猪肉", "肉类", 395, 13.2, 37.0, 2.4),

    # 水果
    ("苹果", "水果", 52, 0.3, 0.2, 14.0),
    ("香蕉", "水果", 89, 1.1, 0.3, 23.0),
    ("橙子", "水果", 47, 0.9, 0.1, 12.0),

    # 饮品
    ("牛奶", "饮品", 42, 3.4, 1.0, 5.0),
    ("豆浆", "饮品", 31, 3.0, 1.6, 1.8),

    # 蛋类
    ("鸡蛋", "蛋类", 155, 13.0, 11.0, 1.1),
    ("茶叶蛋", "蛋类", 155, 13.0, 11.0, 1.1),

    # 豆制品
    ("豆腐", "豆制品", 76, 8.0, 4.8, 1.9),

    # 汤类
    ("蛋花汤", "汤类", 35, 2.5, 1.5, 2.5),
    ("紫菜汤", "汤类", 22, 1.5, 0.5, 2.5),

    # 水产
    ("清蒸鱼", "水产", 102, 18.4, 3.2, 0.0),
    ("白灼虾", "水产", 99, 20.3, 1.5, 0.2),
]

SEED_PORTION = [
    # (food_name, default_g, unit)
    ("宫保鸡丁", 350, "份"),
    ("麻婆豆腐", 300, "份"),
    ("回锅肉", 300, "份"),
    ("水煮鱼", 400, "份"),
    ("夫妻肺片", 200, "份"),
    ("番茄炒蛋", 250, "份"),
    ("红烧肉", 300, "份"),
    ("青椒肉丝", 300, "份"),
    ("可乐鸡翅", 300, "份"),
    ("醋溜白菜", 300, "份"),
    ("米饭", 200, "碗"),
    ("蛋炒饭", 300, "碗"),
    ("馒头", 100, "个"),
    ("面条", 300, "碗"),
    ("小米粥", 300, "碗"),
    ("饺子", 250, "份"),
    ("馄饨", 250, "碗"),
    ("春卷", 150, "份"),
    ("炒青菜", 250, "份"),
    ("西兰花", 200, "份"),
    ("番茄", 150, "个"),
    ("胡萝卜", 150, "根"),
    ("鸡胸肉", 200, "份"),
    ("牛肉", 200, "份"),
    ("猪肉", 200, "份"),
    ("苹果", 200, "个"),
    ("香蕉", 150, "根"),
    ("橙子", 200, "个"),
    ("牛奶", 250, "杯"),
    ("豆浆", 300, "杯"),
    ("鸡蛋", 60, "个"),
    ("茶叶蛋", 60, "个"),
    ("豆腐", 300, "份"),
    ("蛋花汤", 400, "碗"),
    ("紫菜汤", 400, "碗"),
    ("清蒸鱼", 300, "份"),
    ("白灼虾", 250, "份"),
]

# 按类别推断默认份量（当 food_portion 表里没有时用）
CATEGORY_DEFAULTS = {
    "川菜": (350, "份"), "家常菜": (300, "份"), "小吃": (200, "份"),
    "肉类": (200, "份"), "蔬菜": (250, "份"), "主食": (250, "碗"),
    "水果": (200, "个"), "饮品": (250, "杯"), "蛋类": (60, "个"),
    "豆制品": (300, "份"), "汤类": (400, "碗"), "水产": (250, "份"),
}
FALLBACK_PORTION = (300, "份")


async def seed_data() -> None:
    """如果 nutrition 表为空，插入种子数据"""
    async with aiosqlite.connect(DB_PATH) as db:
        # 只插一次
        cursor = await db.execute("SELECT COUNT(*) FROM food_nutrition")
        row = await cursor.fetchone()
        if row and row[0] > 0:
            return

        await db.executemany(
            "INSERT INTO food_nutrition (food_name, category, calories, protein_g, fat_g, carbs_g) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            SEED_NUTRITION,
        )
        await db.executemany(
            "INSERT INTO food_portion (food_name, default_g, unit) VALUES (?, ?, ?)",
            SEED_PORTION,
        )
        await db.commit()


# ================================================================
# 查询接口
# ================================================================

async def search(food_name: str, limit: int = 5) -> list[dict]:
    """模糊搜索，精确匹配排最前"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # 精确匹配权重最大，然后是 LIKE 匹配
        cursor = await db.execute(
            "SELECT *, "
            "CASE WHEN food_name = ? THEN 0 ELSE 1 END AS sort_order "
            "FROM food_nutrition "
            "WHERE food_name LIKE ? "
            "ORDER BY sort_order, food_name "
            "LIMIT ?",
            (food_name, f"%{food_name}%", limit),
        )
        return [dict(row) for row in await cursor.fetchall()]


async def get_by_name(food_name: str) -> Optional[dict]:
    """精确查找"""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM food_nutrition WHERE food_name = ?", (food_name,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_portion(food_name: str) -> dict:
    """
    获取默认份量。
    优先级：food_portion 表 → category 推断 → 兜底 300g
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # 1. 查 food_portion
        cursor = await db.execute(
            "SELECT default_g, unit FROM food_portion WHERE food_name = ?", (food_name,)
        )
        row = await cursor.fetchone()
        if row:
            return {"grams": row["default_g"], "unit": row["unit"]}

        # 2. 查 category 推断
        cursor = await db.execute(
            "SELECT category FROM food_nutrition WHERE food_name = ?", (food_name,)
        )
        row = await cursor.fetchone()
        if row and row["category"] in CATEGORY_DEFAULTS:
            g, u = CATEGORY_DEFAULTS[row["category"]]
            return {"grams": g, "unit": u}

        # 3. 兜底
        return {"grams": FALLBACK_PORTION[0], "unit": FALLBACK_PORTION[1]}


async def list_names() -> list[str]:
    """获取所有菜名，给 Chinese-CLIP 当 labels 用"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT food_name FROM food_nutrition ORDER BY food_name")
        return [row[0] for row in await cursor.fetchall()]
