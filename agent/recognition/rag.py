"""
ChromaDB RAG — 营养知识库检索

2277 条文档，来自《营养学》教材，涵盖：
  基础营养、食物营养、人群营养、疾病营养、营养强化等 8 篇

嵌入模型：BAAI/bge-small-zh-v1.5（免费，~100MB）
"""
import chromadb
from chromadb.utils import embedding_functions

COLLECTION_NAME = "nutrition_textbook"
DB_PATH = "./chroma_db"

_collection = None


def init_rag() -> None:
    """加载 ChromaDB collection（服务启动时调用一次）"""
    global _collection
    ef = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="BAAI/bge-small-zh-v1.5"
    )
    client = chromadb.PersistentClient(path=DB_PATH)
    # chromadb 的 EmbeddingFunction 类型与 sentence-transformers 不兼容（第三方 stub 问题）
    _collection = client.get_collection(COLLECTION_NAME, embedding_function=ef)  # type: ignore[arg-type]


def search(query: str, top_k: int = 3) -> list[str]:
    """
    搜索知识库，返回相关文档段落列表。

    被 search_nutrition_knowledge 工具函数调用。
    """
    if _collection is None:
        return ["知识库未初始化"]
    results = _collection.query(query_texts=[query], n_results=top_k)
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
