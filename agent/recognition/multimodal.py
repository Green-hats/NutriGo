"""
Chinese-CLIP 食物图片识别

模型：OFA-Sys/chinese-clip-vit-base-patch16 (~750MB)
原理：图片向量 与 所有菜名向量 算余弦相似度，取 Top-K

性能优化（面向 2C4G CPU 服务器）：
  - 文本向量预计算缓存：菜名固定不变，仅首次编码一次，识别时只跑 vision encoder
  - 默认保留 fp32 精度；int8 需显式开启并验证识别效果
  - 线程控制：torch.set_num_threads(2) 匹配双核；全局关闭梯度

用法：
  load_model()                   # 首次调用时下载加载模型
  identify(image_bytes, labels)  # labels 从 nutrition.db 获取
"""

import io
import logging
import os
import threading
from typing import Any

import torch
from PIL import Image

from app.config import settings

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
_TEXT_BATCH_SIZE = 32
# 一次只执行一个推理任务，避免双核小内存机器并发加载和激活值叠加。
_INFERENCE_LOCK = threading.RLock()


def _configure_torch() -> None:
    """全局推理优化：限制线程、关闭梯度"""
    torch.set_num_threads(_NUM_THREADS)
    torch.set_grad_enabled(False)


def load_model() -> None:
    """加载模型和 processor；量化仅在显式配置后启用。"""
    with _INFERENCE_LOCK:
        global _model, _processor, _loaded

        if _loaded:
            return

        _configure_torch()

        from transformers import ChineseCLIPModel, ChineseCLIPProcessor

        model_name = settings.FOOD_MODEL_PATH
        local_only = os.path.isabs(model_name) or os.path.isdir(model_name)
        model = ChineseCLIPModel.from_pretrained(model_name, local_files_only=local_only)

        # 量化会改变候选排序，不能只凭模型能运行就默认开启。
        if settings.FOOD_MODEL_INT8:
            try:
                model = torch.quantization.quantize_dynamic(
                    model, {torch.nn.Linear}, dtype=torch.qint8
                )
                logger.info("Chinese-CLIP 已启用 int8 动态量化")
            except Exception as e:
                logger.warning("int8 量化失败，回退 fp32: %s", e)
        else:
            logger.info("Chinese-CLIP 使用 fp32 精度")

        model.eval()
        _model = model
        _processor = ChineseCLIPProcessor.from_pretrained(model_name, local_files_only=local_only)
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

    batches = []
    with torch.no_grad():
        for start in range(0, len(labels), _TEXT_BATCH_SIZE):
            inputs = _processor(
                text=labels[start:start + _TEXT_BATCH_SIZE], return_tensors="pt", padding=True
            )
            outputs = _model.get_text_features(**inputs)
            # Transformers 4 返回 Tensor，5 返回带 pooler_output 的对象。
            features = getattr(outputs, "pooler_output", outputs)
            batches.append(torch.nn.functional.normalize(features, dim=-1))
    text_features = torch.cat(batches, dim=0)

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

    性能：文本向量缓存命中后仅跑 vision encoder，耗时取决于 CPU 和图片大小。
    """
    with _INFERENCE_LOCK:
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
            image_features = getattr(outputs, "pooler_output", outputs)
            image_features = torch.nn.functional.normalize(image_features, dim=-1)

            # 均已归一化 → 点积即余弦相似度
            logits = (image_features @ text_features.T) * _model.logit_scale.exp()
            probs = logits.softmax(dim=1)

        values, indices = probs[0].topk(min(top_k, len(labels)))

        results = []
        for val, idx in zip(values.tolist(), indices.tolist(), strict=True):
            results.append({
                "name": labels[idx],
                "confidence": round(val, 4),
            })
        return results


def warmup(labels: list[str]) -> None:
    """在接收请求前加载权重和菜名向量；失败时保持服务未就绪。"""
    if not labels:
        raise RuntimeError("食物识别候选菜名为空，请检查营养数据库")
    with _INFERENCE_LOCK:
        load_model()
        _encode_texts(labels)
    logger.info("食物识别预热完成，候选菜名 %d 个", len(labels))
