"""
server_payments.py — 支付 Provider 注册表与验单 / Webhook 校验（MO-2 / CS-4）

设计：把「验单」与「Webhook 验签 + 事件解析」抽象成 provider 维度，默认 `stub`
用共享密钥（API_SECRET_KEY）做 HMAC 验签，让整条支付管线在无真实商户号时也能
端到端跑通；接入微信/支付宝/Stripe 时只实现对应分支即可（已留骨架）。

仅依赖标准库。
"""

from __future__ import annotations

import os
import hmac
import time
import json
import hashlib


def _secret() -> str:
    return os.environ.get("API_SECRET_KEY", "openblock-dev-secret")


def _canonical_receipt(payload: dict) -> str:
    """验单签名的规范串：稳定字段拼接（与客户端/对账方约定一致）。"""
    fields = ["user_id", "sku", "provider", "provider_ref", "amount_minor", "currency"]
    return "|".join(str(payload.get(f, "")) for f in fields)


def sign_receipt(payload: dict, secret: str | None = None) -> str:
    """生成 stub 验单签名（供客户端 / 测试 / 对账方使用）。"""
    msg = _canonical_receipt(payload).encode("utf-8")
    return hmac.new((secret or _secret()).encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _provider_keys_present(provider: str) -> bool:
    if provider == "wechat":
        return bool(os.environ.get("WECHAT_MCH_ID") and os.environ.get("WECHAT_APIV3_KEY"))
    if provider == "alipay":
        return bool(os.environ.get("ALIPAY_APP_ID") and os.environ.get("ALIPAY_PRIVATE_KEY"))
    if provider == "stripe":
        return bool(os.environ.get("STRIPE_SECRET_KEY"))
    return False


def verify_purchase(payload: dict) -> tuple[bool, str, str]:
    """
    校验一笔购买回执。
    返回 (ok, normalized_status, reason)。
      - stub：金额>0 且有 provider_ref；若带 `signature` 则必须 HMAC 校验通过。
      - wechat/alipay/stripe：缺凭据→(False,'unconfigured',...)；有凭据→留待真实实现。
    """
    provider = (payload.get("provider") or "stub").lower()
    amount = int(payload.get("amount_minor") or 0)
    ref = str(payload.get("provider_ref") or "")

    if provider == "stub":
        sig = payload.get("signature")
        if sig:
            expected = sign_receipt(payload)
            if not hmac.compare_digest(str(sig), expected):
                return (False, "rejected", "bad_signature")
        if amount <= 0 or not ref:
            return (False, "rejected", "missing_amount_or_ref")
        return (True, "completed", "ok")

    if provider in ("wechat", "alipay", "stripe"):
        if not _provider_keys_present(provider):
            return (False, "unconfigured", f"{provider}_not_configured")
        # 真实实现：调用渠道订单查询接口 + 验签。骨架默认拒绝，避免误判为已付。
        return (False, "rejected", f"{provider}_verify_not_implemented")

    return (False, "rejected", "unknown_provider")


# ── CS-4：Webhook 验签 + 事件解析 ───────────────────────────────────────────

def verify_webhook_signature(provider: str, raw_body: bytes, signature: str) -> bool:
    """校验异步通知签名。stub 用 HMAC-SHA256(raw_body)；渠道分支留骨架。"""
    provider = (provider or "stub").lower()
    if provider == "stub":
        expected = hmac.new(_secret().encode("utf-8"), raw_body or b"", hashlib.sha256).hexdigest()
        return hmac.compare_digest(str(signature or ""), expected)
    if provider in ("wechat", "alipay", "stripe"):
        # 真实实现：各渠道证书 / 公钥验签。未配置时拒绝。
        return False
    return False


def sign_webhook(raw_body: bytes, secret: str | None = None) -> str:
    """生成 stub webhook 签名（测试 / 模拟渠道回调用）。"""
    return hmac.new((secret or _secret()).encode("utf-8"), raw_body or b"", hashlib.sha256).hexdigest()


def parse_webhook_event(provider: str, body: dict) -> dict:
    """
    归一化 Webhook 事件。返回：
      { type: 'payment'|'refund'|'unknown', user_id, sku, provider_ref, amount_minor, status }
    stub 直接采用 body 字段；渠道分支按各自报文映射（骨架）。
    """
    etype = (body.get("event_type") or body.get("type") or "").lower()
    norm_type = "unknown"
    if etype in ("payment", "payment.succeeded", "transaction.completed", "trade_success"):
        norm_type = "payment"
    elif etype in ("refund", "refund.succeeded", "trade_refund", "charge.refunded"):
        norm_type = "refund"
    return {
        "type": norm_type,
        "user_id": body.get("user_id") or body.get("userId") or "",
        "sku": body.get("sku") or "",
        "provider_ref": body.get("provider_ref") or body.get("transaction_id") or "",
        "amount_minor": int(body.get("amount_minor") or 0),
        "status": body.get("status") or norm_type,
        "ts": int(body.get("ts") or time.time()),
    }
