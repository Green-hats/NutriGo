"""
ChromaDB RAG — 营养知识库检索

2277 条文档，来自《营养学》教材，涵盖：
  基础营养、食物营养、人群营养、疾病营养、营养强化等 8 篇

嵌入模型：BAAI/bge-small-zh-v1.5（免费，~100MB）
"""
import logging
import re
import unicodedata
from pathlib import Path

import chromadb
from chromadb.utils import embedding_functions

from app.config import settings

logger = logging.getLogger("uvicorn")

COLLECTION_NAME = "nutrition_textbook"
DB_PATH = "./chroma_db"

_collection = None


def _vitamin_filter(query: str) -> dict | None:
    """指定维生素名称时先限定正文，避免 C/D/E 等相近语义混淆。"""
    normalized = unicodedata.normalize("NFKC", query)
    names = re.findall(r"维生素\s*([A-EK](?:\s*\d{1,2})?)", normalized, re.I)
    if not names:
        return None
    # 比较问题也保留省略了“维生素”的第二个名称，如“维生素C与D”。
    names += re.findall(r"(?:和|与|及|、|/)\s*([A-EK](?:\s*\d{1,2})?)(?![a-z\d])", normalized, re.I)
    names = [re.sub(r"\s+", "", name) for name in names]
    terms = sorted({
        f"维生素{space}{name.upper() if upper else name.lower()}"
        for name in names for space in ("", " ", "\n") for upper in (True, False)
    })
    return {"$or": [{"$contains": term} for term in terms]} if terms else None


def init_rag() -> None:
    """加载 ChromaDB collection（服务启动时调用一次）。

    知识库缺失/损坏时降级为 None（搜索返回"未初始化"提示），不阻塞服务启动。
    """
    global _collection
    try:
        model_path = settings.RAG_MODEL_PATH
        ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=model_path,
            local_files_only=Path(model_path).is_absolute() or Path(model_path).is_dir(),
        )
        client = chromadb.PersistentClient(path=DB_PATH)
        # chromadb 的 EmbeddingFunction 类型与 sentence-transformers 不兼容（第三方 stub 问题）
        _collection = client.get_collection(COLLECTION_NAME, embedding_function=ef)  # type: ignore[arg-type]
        count = _collection.count()
        if count == 0:
            raise ValueError("知识库为空")
        logger.info("RAG 知识库已加载: %s, %d 条文档", DB_PATH, count)
    except Exception as e:
        logger.warning(f"RAG 初始化失败（知识库缺失或损坏？），营养知识搜索不可用: {e}")
        _collection = None


def search(query: str, top_k: int = 3) -> list[str]:
    """
    搜索知识库，返回相关文档段落列表。

    被 search_nutrition_knowledge 工具函数调用。
    """
    if _collection is None:
        return ["知识库未初始化"]
    results = _collection.query(
        query_texts=[query], n_results=top_k, where_document=_vitamin_filter(query),
    )
    documents = results.get("documents") or []
    return documents[0] if documents else []  # type: ignore[return-value]


async def search_nutrition_knowledge(query: str) -> str:
    """
    Agent 工具：搜索营养学知识库。

    LLM 可用此工具回答专业营养问题，
    如糖尿病饮食、孕期营养、运动营养等。
    """
    if _collection is None:
        return "知识库暂未初始化"

    docs = search(query, top_k=3)
    if not docs:
        return "未找到相关知识"

    MAX_SEGMENT_CHARS = 300
    parts = []
    for i, doc in enumerate(docs, 1):
        text = doc.strip()
        if len(text) > MAX_SEGMENT_CHARS:
            text = text[:MAX_SEGMENT_CHARS] + "……(省略)"
        parts.append(f"[资料{i}]\n{text}")
    return "\n\n---\n\n".join(parts)
