"""
Chinese-CLIP 食物图片识别

模型：OFA-Sys/chinese-clip-vit-base-patch16 (~400MB)
原理：图片向量 与 所有菜名向量 算余弦相似度，取 Top-K

性能优化（面向 2C4G CPU 服务器）：
  - 文本向量预计算缓存：菜名固定不变，仅首次编码一次，识别时只跑 vision encoder
  - int8 动态量化：模型权重 fp32 → int8，常驻内存约降 1GB
  - 线程控制：torch.set_num_threads(2) 匹配双核；全局关闭梯度

用法：
  load_model()                   # 首次调用时下载加载模型
  identify(image_bytes, labels)  # labels 从 nutrition.db 获取
"""

import io
import logging
from typing import Any

import torch
from PIL import Image

logger = logging.getLogger(__name__)

# 延迟导入，避免启动时就加载（首次推理时才加载模型）
# 类型为 Any：transformers 模型类型复杂且无 mypy stubs，实际运行由 load_model 保证非空
_model: Any = None
_processor: Any = None
_loaded = False

# 文本向量缓存：{tuple(labels): (text_features, labels)}
# 菜名集合固定，识别时跳过 text encoder，只跑 vision encoder
_TEXT_CACHE: dict[tuple[str, ...], tuple[Any, list[str]]] = {}
_TEXT_CACHE_MAX = 8

# 推理线程数（2C4G 服务器建议 2，过多线程徒增切换开销）
_NUM_THREADS = 2


def _configure_torch() -> None:
    """全局推理优化：限制线程、关闭梯度"""
    torch.set_num_threads(_NUM_THREADS)
    torch.set_grad_enabled(False)


def load_model() -> None:
    """加载 Chinese-CLIP 模型和 processor（首次调用自动触发），并做 int8 量化"""
    global _model, _processor, _loaded

    if _loaded:
        return

    _configure_torch()

    from transformers import ChineseCLIPModel, ChineseCLIPProcessor

    model_name = "OFA-Sys/chinese-clip-vit-base-patch16"
    model = ChineseCLIPModel.from_pretrained(model_name)

    # int8 动态量化：降低常驻内存，CPU 推理更快；失败则回退 fp32
    try:
        model = torch.quantization.quantize_dynamic(
            model, {torch.nn.Linear}, dtype=torch.qint8
        )
        logger.info("Chinese-CLIP 已启用 int8 动态量化")
    except Exception as e:
        logger.warning("int8 量化失败，回退 fp32: %s", e)

    model.eval()
    _model = model
    _processor = ChineseCLIPProcessor.from_pretrained(model_name)
    _loaded = True


def _encode_texts(labels: list[str]) -> tuple[Any, list[str]]:
    """
    对菜名列表做一次文本编码并缓存（按菜名元组为键）。

    返回 (归一化后的 text_features, labels)。
    """
    cache_key = tuple(labels)
    hit = _TEXT_CACHE.get(cache_key)
    if hit is not None:
        return hit

    # 防止缓存无限增长
    if len(_TEXT_CACHE) >= _TEXT_CACHE_MAX:
        _TEXT_CACHE.clear()

    inputs = _processor(text=labels, return_tensors="pt", padding=True)
    with torch.no_grad():
        outputs = _model.get_text_features(**inputs)
        text_features = outputs.pooler_output
    text_features = torch.nn.functional.normalize(text_features, dim=-1)

    _TEXT_CACHE[cache_key] = (text_features, labels)
    return text_features, labels


def identify(image_bytes: bytes, labels: list[str], top_k: int = 5) -> list[dict]:
    """
    识别食物图片，返回 Top-K 候选。

    参数：
      image_bytes — 图片二进制数据（从 Go 后端获取）
      labels      — 候选菜名列表（从 nutrition.db 获取）
      top_k       — 返回几个结果

    返回：
      [{"name": "宫保鸡丁", "confidence": 0.8732}, ...]

    性能：文本向量缓存命中后仅跑 vision encoder，单张 CPU 推理约 2-3s。
    """
    load_model()

    if not labels:
        return []

    # 1. 预计算（或命中缓存）文本向量 —— 只算一次，跳过 text encoder
    text_features, labels = _encode_texts(labels)

    # 2. 解码图片
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # 3. 仅编码图片（vision encoder）并算余弦相似度
    inputs = _processor(images=image, return_tensors="pt")
    with torch.no_grad():
        outputs = _model.get_image_features(**inputs)
        image_features = outputs.pooler_output
        image_features = torch.nn.functional.normalize(image_features, dim=-1)

        # 均已归一化 → 点积即余弦相似度
        logits = image_features @ text_features.T
        probs = logits.softmax(dim=1)

    values, indices = probs[0].topk(min(top_k, len(labels)))

    results = []
    for val, idx in zip(values.tolist(), indices.tolist(), strict=True):
        results.append({
            "name": labels[idx],
            "confidence": round(val, 4),
        })
    return results
