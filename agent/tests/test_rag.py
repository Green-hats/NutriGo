"""RAG 本地模型加载、空库和损坏索引的降级行为。"""

from unittest.mock import Mock

import pytest

from recognition import rag


@pytest.fixture
def rag_backend(monkeypatch):
    collection = Mock()
    collection.count.return_value = 2277
    client = Mock()
    client.get_collection.return_value = collection
    embedding = Mock()
    monkeypatch.setattr(rag, "_collection", None)
    monkeypatch.setattr(rag.chromadb, "PersistentClient", Mock(return_value=client))
    monkeypatch.setattr(rag.embedding_functions, "SentenceTransformerEmbeddingFunction", embedding)
    return collection, client, embedding


def test_local_model_never_requires_network(monkeypatch, rag_backend, tmp_path):
    collection, _, embedding = rag_backend
    monkeypatch.setattr(rag.settings, "RAG_MODEL_PATH", str(tmp_path / "bge"))
    rag.init_rag()
    embedding.assert_called_once_with(model_name=str(tmp_path / "bge"), local_files_only=True)
    assert rag._collection is collection


def test_remote_model_id_remains_supported(monkeypatch, rag_backend):
    _, _, embedding = rag_backend
    monkeypatch.setattr(rag.settings, "RAG_MODEL_PATH", "BAAI/bge-small-zh-v1.5")
    rag.init_rag()
    embedding.assert_called_once_with(model_name="BAAI/bge-small-zh-v1.5", local_files_only=False)


async def test_empty_collection_is_unavailable(rag_backend):
    collection, _, _ = rag_backend
    collection.count.return_value = 0
    rag.init_rag()
    assert rag._collection is None
    assert await rag.search_nutrition_knowledge("测试") == "知识库暂未初始化"


def test_broken_collection_clears_previous_state(monkeypatch, rag_backend):
    _, client, _ = rag_backend
    monkeypatch.setattr(rag, "_collection", Mock())
    client.get_collection.side_effect = RuntimeError("invalid index")
    rag.init_rag()
    assert rag._collection is None
