"""
Chinese-CLIP 食物图片识别

模型：OFA-Sys/chinese-clip-vit-base-patch16 (~400MB)
原理：图片向量 与 所有菜名向量 算余弦相似度，取 Top-K

用法：
  load_model()                   # 首次调用时下载加载模型
  identify(image_bytes, labels)  # labels 从 nutrition.db 获取
"""

import io
from typing import Any

import torch
from PIL import Image

# 延迟导入，避免启动时就加载（首次推理时才加载模型）
# 类型为 Any：transformers 模型类型复杂且无 mypy stubs，实际运行由 load_model 保证非空
_model: Any = None
_processor: Any = None
_loaded = False


def load_model() -> None:
    """加载 Chinese-CLIP 模型和 processor（首次调用自动触发）"""
    global _model, _processor, _loaded

    if _loaded:
        return

    from transformers import ChineseCLIPModel, ChineseCLIPProcessor

    model_name = "OFA-Sys/chinese-clip-vit-base-patch16"
    _model = ChineseCLIPModel.from_pretrained(model_name)
    _processor = ChineseCLIPProcessor.from_pretrained(model_name)
    _loaded = True


def identify(image_bytes: bytes, labels: list[str], top_k: int = 5) -> list[dict]:
    """
    识别食物图片，返回 Top-K 候选。

    参数：
      image_bytes — 图片二进制数据（从 Go 后端获取）
      labels      — 候选菜名列表（从 nutrition.db 获取）
      top_k       — 返回几个结果

    返回：
      [{"name": "宫保鸡丁", "confidence": 0.8732}, ...]
    """
    load_model()

    # 解码图片
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # CLIP 推理
    inputs = _processor(images=image, text=labels, return_tensors="pt", padding=True)

    with torch.no_grad():
        outputs = _model(**inputs)
        logits_per_image = outputs.logits_per_image
        probs = logits_per_image.softmax(dim=1)

    values, indices = probs[0].topk(min(top_k, len(labels)))

    results = []
    for val, idx in zip(values.tolist(), indices.tolist(), strict=True):
        results.append({
            "name": labels[idx],
            "confidence": round(val, 4),
        })
    return results
