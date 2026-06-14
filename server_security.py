"""
server_security.py — server.py 的写鉴权 (CS-2) 与权益确权 (MO-5)

自包含、零三方依赖（仅 stdlib），便于 server.py 直接 import 与单测覆盖。

CS-2 写上报鉴权
---------------
对敏感写端点要求 HMAC-SHA256 请求签名（`X-Signature: <ts>.<hex>`，与
services/security/signing.py 同算法）。默认**关闭**（`OPENBLOCK_REQUIRE_WRITE_AUTH=0`），
避免破坏现有客户端与既有测试；生产置 1 强制校验。

MO-5 权益服务端确权
-------------------
"移除广告 / 订阅"等权益由服务端签发不可篡改令牌（payload.signature），客户端持令牌，
读取权益时服务端校验签名与过期，杜绝客户端本地 localStorage 篡改 `isAdsRemoved`。
"""

import os
import time
import json
import hmac
import base64
import hashlib
from functools import wraps


def _secret() -> str:
    return os.environ.get("OPENBLOCK_API_SECRET") or os.environ.get(
        "API_SECRET_KEY", "default_secret_key"
    )


def write_auth_required() -> bool:
    return os.environ.get("OPENBLOCK_REQUIRE_WRITE_AUTH", "0").lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


# ── 请求签名（CS-2） ────────────────────────────────────────────────────────

_SIGN_WINDOW_SEC = 300


def _canonical(method: str, path: str, ts: int, body: dict | None) -> str:
    parts = [method.upper(), path, str(ts)]
    if body:
        parts.append(json.dumps(body, sort_keys=True, separators=(",", ":")))
    return "|".join(parts)


def sign_request(method: str, path: str, body: dict | None = None, ts: int | None = None) -> str:
    """生成 `<ts>.<hex>` 签名（供客户端 / 测试调用）。"""
    if ts is None:
        ts = int(time.time())
    msg = _canonical(method, path, ts, body)
    sig = hmac.new(_secret().encode(), msg.encode(), hashlib.sha256).hexdigest()
    return f"{ts}.{sig}"


def verify_request(signature: str, method: str, path: str, body: dict | None = None):
    """校验签名。返回 (ok: bool, error: str|None)。"""
    if not signature:
        return False, "missing_signature"
    try:
        ts_str, sig = signature.split(".", 1)
        ts = int(ts_str)
    except (ValueError, AttributeError):
        return False, "bad_signature_format"
    if abs(int(time.time()) - ts) > _SIGN_WINDOW_SEC:
        return False, "signature_expired"
    expected = hmac.new(
        _secret().encode(), _canonical(method, path, ts, body).encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return False, "signature_mismatch"
    return True, None


def require_write_auth(fn):
    """Flask 路由装饰器：启用时强制 X-Signature 校验，否则放行。"""

    @wraps(fn)
    def _wrapped(*args, **kwargs):
        if write_auth_required():
            from flask import request, jsonify

            sig = request.headers.get("X-Signature", "")
            body = request.get_json(silent=True) or {}
            ok, err = verify_request(sig, request.method, request.path, body)
            if not ok:
                return jsonify({"error": err, "code": "INVALID_SIGNATURE"}), 401
        return fn(*args, **kwargs)

    return _wrapped


# ── 权益令牌（MO-5） ────────────────────────────────────────────────────────


def _b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def issue_entitlement(user_id: str, sku: str, expires_at: int | None = None, scopes=None) -> str:
    """签发权益令牌：`<b64url(payload)>.<hex sig>`。expires_at 为 None 表示永久。"""
    payload = {
        "uid": str(user_id),
        "sku": str(sku),
        "iat": int(time.time()),
        "exp": int(expires_at) if expires_at else None,
        "scopes": list(scopes) if scopes else [sku],
    }
    body = _b64u_encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())
    sig = hmac.new(_secret().encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_entitlement(token: str):
    """校验权益令牌。返回 (payload: dict|None, error: str|None)。"""
    if not token or "." not in token:
        return None, "missing_token"
    body, _, sig = token.partition(".")
    expected = hmac.new(_secret().encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None, "signature_mismatch"
    try:
        payload = json.loads(_b64u_decode(body).decode())
    except (ValueError, json.JSONDecodeError):
        return None, "bad_payload"
    exp = payload.get("exp")
    if exp is not None and int(time.time()) > int(exp):
        return None, "expired"
    return payload, None
