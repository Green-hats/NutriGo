"""
工具注册系统 — @tool 装饰器 + ToolRegistry

工具是 LLM 可以调用的函数。注册后的工具会：
  1. 转为 OpenAI function calling 格式发给 LLM
  2. LLM 返回 tool_call 时，由 Agent Loop 执行对应的 Python 函数

用法：
    registry = ToolRegistry()
    registry.register(lookup_food_nutrition)
    # 或
    @registry.tool
    def lookup_food_nutrition(food_name: str) -> dict: ...

阶段 3 只搭骨架，工具实现在阶段 4 完成。这里先注册一个占位示例。
"""

import json
import inspect
from typing import Any, Callable


class RegisteredTool:
    """一个已注册的工具，包含元数据和执行函数"""

    def __init__(self, func: Callable, name: str, description: str):
        self.func = func                     # 原始 Python 函数
        self.name = name                     # 工具名称（发给 LLM）
        self.description = description       # 工具描述（发给 LLM，告诉它什么时候用）
        self.parameters = self._build_schema(func)  # 从函数签名自动生成的 JSON Schema

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
        """执行工具，返回字符串结果"""
        try:
            args = json.loads(arguments_json)
        except json.JSONDecodeError:
            return f"参数解析失败: {arguments_json}"
        try:
            result = self.func(**args)
            if isinstance(result, str):
                return result
            return json.dumps(result, ensure_ascii=False)
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
        """按名称获取工具"""
        return self._tools.get(name)

    def to_openai_format(self) -> list[dict]:
        """转为 OpenAI function calling 格式的列表"""
        return [t.to_openai() for t in self._tools.values()]


# ============================================================
# 全局工具注册表 + 占位示例工具
# ============================================================

registry = ToolRegistry()


# ---------- 占位工具（阶段 4 替换为真实实现）----------

@registry.tool(
    name="get_current_time",
    description="获取当前时间。当你需要知道今天的日期或时间时调用。"
)
def get_current_time() -> str:
    """返回当前日期时间"""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S 星期%w")


@registry.tool(
    name="calculate_bmi",
    description="根据身高和体重计算 BMI，并给出体重评估。"
)
def calculate_bmi(height_cm: float, weight_kg: float) -> str:
    """计算 BMI"""
    height_m = height_cm / 100
    bmi = weight_kg / (height_m * height_m)
    if bmi < 18.5:
        level = "偏瘦"
        advice = "建议适当增加营养摄入，增重到正常范围。"
    elif bmi < 24:
        level = "正常"
        advice = "体重在健康范围内，请继续保持！"
    elif bmi < 28:
        level = "偏胖"
        advice = "建议控制饮食，增加运动量。"
    else:
        level = "肥胖"
        advice = "建议咨询医生，制定减重计划。"
    return f"BMI: {bmi:.1f}，属于{level}范围。{advice}"
