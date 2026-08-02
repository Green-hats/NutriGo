"""
工具注册系统 — @tool 装饰器 + ToolRegistry

阶段 3 的占位工具（get_current_time, calculate_bmi）已移除，
替换为 recognition/nutrition.py 中的真实 Agent 工具。
"""

import json
import inspect
from typing import Any, Callable


class RegisteredTool:
    """一个已注册的工具，包含元数据和执行函数"""

    def __init__(self, func: Callable, name: str, description: str):
        self.func = func
        self.name = name
        self.description = description
        self.parameters = self._build_schema(func)

    def _build_schema(self, func: Callable) -> dict:
        """从函数的类型注解推断参数 schema"""
        sig = inspect.signature(func)
        properties = {}
        required = []

        for param_name, param in sig.parameters.items():
            if param_name in ("self", "cls"):
                continue
            param_type = "string"
            if param.annotation != inspect.Parameter.empty:
                if param.annotation is int:
                    param_type = "integer"
                elif param.annotation is float:
                    param_type = "number"

            properties[param_name] = {"type": param_type}
            if param.default == inspect.Parameter.empty:
                required.append(param_name)

        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }

    def to_openai(self) -> dict:
        """转为 OpenAI function calling 格式"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def execute(self, arguments_json: str) -> str:
        """同步执行（async 工具请用 execute_async）"""
        try:
            args = json.loads(arguments_json)
        except json.JSONDecodeError:
            return f"参数解析失败: {arguments_json}"
        try:
            result = self.func(**args)
            return result
        except Exception as e:
            return f"工具执行出错: {e}"

    async def execute_async(self, arguments_json: str) -> str:
        """异步执行"""
        try:
            args = json.loads(arguments_json)
        except json.JSONDecodeError:
            return f"参数解析失败: {arguments_json}"
        try:
            result = self.func(**args)
            if inspect.iscoroutine(result):
                result = await result
            return result
        except Exception as e:
            return f"工具执行出错: {e}"


class ToolRegistry:
    """工具注册表 — 管理所有可用工具"""

    def __init__(self):
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, func: Callable, name: str = "", description: str = "") -> RegisteredTool:
        """注册一个函数为工具"""
        tool = RegisteredTool(
            func,
            name=name or func.__name__,
            description=description or func.__doc__ or "",
        )
        self._tools[tool.name] = tool
        return tool

    def tool(self, name: str = "", description: str = ""):
        """装饰器风格注册：@registry.tool(name="xxx", description="yyy")"""
        def wrapper(func: Callable):
            self.register(func, name, description)
            return func
        return wrapper

    def get(self, name: str) -> RegisteredTool | None:
        return self._tools.get(name)

    def to_openai_format(self) -> list[dict]:
        return [t.to_openai() for t in self._tools.values()]


# ============================================================
# 全局工具注册表 + 注册真正的营养 Agent 工具
# ============================================================

registry = ToolRegistry()

# 从 recognition.nutrition 导入工具函数
from recognition.nutrition import lookup_food_nutrition, get_user_profile, get_diet_history

registry.register(
    lookup_food_nutrition,
    name="lookup_food_nutrition",
    description="查询某种食物每100克的营养成分。当需要知道食物的热量、蛋白质、脂肪、碳水含量时调用。",
)

registry.register(
    get_user_profile,
    name="get_user_profile",
    description="获取用户的健康档案（身高、体重、年龄、目标、过敏原等）。"
                "在给出任何个性化营养建议之前，先调用此工具了解用户情况。",
)

registry.register(
    get_diet_history,
    name="get_diet_history",
    description="获取用户某一天的饮食记录。"
                "当用户询问'我今天吃了什么'、'分析我的饮食'或需要结合已有饮食给出建议时调用。",
)
