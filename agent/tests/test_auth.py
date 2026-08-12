"""JWT 校验（与 Go 后端兼容的 HS256）单元测试"""

import base64
import hashlib
import hmac
import json
import time

from app.auth import extract_user_id, verify_token
from app.config import settings


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(payload: dict, secret: str | None = None, alg: str = "HS256") -> str:
    secret = secret or settings.JWT_SECRET
    header = _b64(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    body = _b64(json.dumps(payload).encode())
    msg = f"{header}.{body}".encode()
    sig = _b64(hmac.new(secret.encode(), msg, hashlib.sha256).digest())
    return f"{header}.{body}.{sig}"


def valid_payload(**overrides: object) -> dict:
    payload: dict = {"user_id": 7, "username": "xiaoming", "exp": int(time.time()) + 3600}
    payload.update(overrides)
    return payload


def test_valid_token_returns_payload():
    result = verify_token(make_token(valid_payload()))
    assert result is not None
    assert result["user_id"] == 7
    assert result["username"] == "xiaoming"


def test_wrong_secret_rejected():
    token = make_token(valid_payload(), secret="wrong-secret")
    assert verify_token(token) is None


def test_expired_token_rejected():
    token = make_token(valid_payload(exp=int(time.time()) - 10))
    assert verify_token(token) is None


def test_tampered_signature_rejected():
    token = make_token(valid_payload())
    tampered = token[:-4] + "AAAA"
    assert verify_token(tampered) is None


def test_alg_none_rejected():
    header = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = _b64(json.dumps(valid_payload()).encode())
    token = f"{header}.{body}."
    assert verify_token(token) is None


def test_missing_exp_still_valid():
    payload = {"user_id": 1, "username": "x"}
    assert verify_token(make_token(payload)) is not None


def test_malformed_token_rejected():
    assert verify_token("not-a-jwt") is None
    assert verify_token("a.b") is None


def test_extract_user_id():
    token = make_token(valid_payload())
    assert extract_user_id(f"Bearer {token}") == 7
    assert extract_user_id(f"bearer {token}") == 7  # 大小写不敏感
    assert extract_user_id(token) is None  # 无 Bearer 前缀


def test_extract_user_id_invalid():
    assert extract_user_id(None) is None
    assert extract_user_id("") is None
    assert extract_user_id("Bearer bad.token.here") is None
