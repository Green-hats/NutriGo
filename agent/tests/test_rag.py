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


def test_vitamin_search_keeps_named_nutrient_constraint(rag_backend):
    collection, _, _ = rag_backend
    collection.query.return_value = {"documents": [["维生素C 的相关内容"]]}
    rag.init_rag()
    assert rag.search("维生素ｃ的作用") == ["维生素C 的相关内容"]
    constraint = collection.query.call_args.kwargs["where_document"]
    assert {"$contains": "维生素C"} in constraint["$or"]
    assert {"$contains": "维生素 c"} in constraint["$or"]
    assert all("维生素D" not in item["$contains"] for item in constraint["$or"])


def test_named_nutrient_without_match_does_not_fall_back(rag_backend):
    collection, _, _ = rag_backend
    collection.query.return_value = {"documents": [[]]}
    rag.init_rag()
    assert rag.search("维生素B12的食物来源") == []
    collection.query.assert_called_once()


def test_general_query_has_no_vitamin_filter(rag_backend):
    collection, _, _ = rag_backend
    collection.query.return_value = {"documents": [["膳食纤维"]]}
    rag.init_rag()
    rag.search("膳食纤维的作用")
    assert collection.query.call_args.kwargs["where_document"] is None


def test_comparing_vitamins_preserves_both_names():
    constraint = rag._vitamin_filter("维生素C与D有什么区别")
    assert {"$contains": "维生素C"} in constraint["$or"]
    assert {"$contains": "维生素D"} in constraint["$or"]
