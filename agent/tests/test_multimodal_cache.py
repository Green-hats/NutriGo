"""无需下载模型，验证菜名分批后的顺序、版本兼容和缓存隔离。"""

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest


@pytest.fixture
def multimodal(monkeypatch):
    torch = MagicMock()
    torch.nn.functional.normalize.side_effect = lambda features, **kw: features
    torch.cat.side_effect = lambda batches, **kw: [name for batch in batches for name in batch]
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "PIL", MagicMock())
    source = Path(__file__).parents[1] / "recognition" / "multimodal.py"
    spec = importlib.util.spec_from_file_location("multimodal_under_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._processor = Mock(side_effect=lambda text, **kw: {"labels": text})
    return module


@pytest.mark.parametrize("wrapped", [False, True])
def test_batched_features_preserve_label_order_and_reuse_cache(multimodal, wrapped):
    def encode(labels):
        return SimpleNamespace(pooler_output=labels) if wrapped else labels

    multimodal._model = SimpleNamespace(get_text_features=Mock(side_effect=encode))
    labels = [f"菜名{i}" for i in range(510)]
    features, returned_labels = multimodal._encode_texts(labels)
    assert features == returned_labels == labels
    calls = multimodal._processor.call_args_list
    assert len(calls) > 1
    assert max(len(call.kwargs["text"]) for call in calls) <= 32
    cached, _ = multimodal._encode_texts(list(labels))
    assert cached is features
    assert multimodal._processor.call_count == len(calls)
    different, _ = multimodal._encode_texts(list(reversed(labels)))
    assert different == list(reversed(labels))


def test_empty_candidates_fail_warmup_before_model_load(multimodal, monkeypatch):
    loader = Mock()
    monkeypatch.setattr(multimodal, "load_model", loader)
    with pytest.raises(RuntimeError, match="候选菜名为空"):
        multimodal.warmup([])
    loader.assert_not_called()
