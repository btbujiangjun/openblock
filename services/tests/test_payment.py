"""Tests for services.security.payment.

Covers:
  * Missing PAYMENT_SECRET_KEY raises PaymentConfigError
  * Short secret raises PaymentConfigError
  * verify_hmac roundtrip with both `custom` and other providers
  * verify_timestamp accepts fresh and rejects old timestamps
"""

from __future__ import annotations

import time

import pytest

from services.security.payment import PaymentConfigError, PaymentVerifier


@pytest.fixture
def verifier():
    return PaymentVerifier()  # picks up env from conftest


class TestConfig:
    def test_missing_secret(self, monkeypatch):
        monkeypatch.delenv("PAYMENT_SECRET_KEY", raising=False)
        with pytest.raises(PaymentConfigError):
            PaymentVerifier()

    def test_short_secret(self, monkeypatch):
        monkeypatch.setenv("PAYMENT_SECRET_KEY", "short")
        with pytest.raises(PaymentConfigError):
            PaymentVerifier()


class TestVerifyHmac:
    def test_custom_roundtrip(self, verifier):
        data = {"order_id": "abc", "amount": 100}
        sig = verifier._create_hmac_signature(data, "custom")
        ok, err = verifier.verify_hmac(data, sig, provider="custom")
        assert ok and err is None

    def test_other_provider_roundtrip(self, verifier):
        data = {"order_id": "abc", "amount": 100}
        sig = verifier._create_hmac_signature(data, "wechat")
        ok, err = verifier.verify_hmac(data, sig, provider="wechat")
        assert ok and err is None

    def test_missing_signature(self, verifier):
        ok, err = verifier.verify_hmac({"order_id": "abc"}, "")
        assert not ok and "Missing" in err

    def test_signature_mismatch(self, verifier):
        ok, err = verifier.verify_hmac({"order_id": "abc"}, "deadbeef")
        assert not ok and "mismatch" in err.lower()


class TestVerifyTimestamp:
    def test_fresh_ok(self, verifier):
        ok, err = verifier.verify_timestamp({"timestamp": int(time.time())})
        assert ok and err is None

    def test_too_old_rejected(self, verifier):
        ok, err = verifier.verify_timestamp(
            {"timestamp": int(time.time()) - 7200}, max_age=3600
        )
        assert not ok
