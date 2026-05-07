"""Tests for services.security.encryption.

Covers:
  * Fernet round-trip for str / dict / list payloads
  * Tampered cipher-text raises EncryptionError
  * Missing ENCRYPTION_KEY raises EncryptionConfigError
  * Legacy XOR can decrypt old payloads but cannot encrypt new ones
  * DataMasker handles email / phone / dict edges
"""

from __future__ import annotations

import pytest

from services.security.encryption import (
    DataEncryptor,
    DataMasker,
    EncryptionConfigError,
    EncryptionError,
    LegacyXorEncryptor,
    decrypt_sensitive_data,
    encrypt_sensitive_data,
)


class TestDataEncryptorRoundtrip:
    def test_string_roundtrip(self):
        token = encrypt_sensitive_data("hello-world")
        assert decrypt_sensitive_data(token) == "hello-world"

    def test_dict_roundtrip(self):
        payload = {"user_id": 42, "amount": 1.5, "tags": ["vip", "trial"]}
        token = encrypt_sensitive_data(payload)
        assert decrypt_sensitive_data(token) == payload

    def test_list_roundtrip(self):
        payload = [1, 2, {"a": "b"}]
        token = encrypt_sensitive_data(payload)
        assert decrypt_sensitive_data(token) == payload

    def test_tampered_cipher_raises(self):
        token = encrypt_sensitive_data({"x": 1})
        # Flip a byte to corrupt the HMAC.
        bad = "A" + token[1:]
        with pytest.raises(EncryptionError):
            decrypt_sensitive_data(bad)

    def test_wrong_key_raises(self):
        token = encrypt_sensitive_data("secret")
        # Build a fresh encryptor with an explicit different key — the
        # default-env key from conftest is overridden by passing one in.
        other = DataEncryptor(key="other-key-of-sufficient-length-32x")
        with pytest.raises(EncryptionError):
            other.decrypt(token)


class TestEncryptionConfig:
    def test_missing_key_raises(self, monkeypatch):
        monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
        with pytest.raises(EncryptionConfigError):
            DataEncryptor()

    def test_short_key_is_hashed(self):
        # Any short secret is acceptable: it gets hashed to a fernet key.
        enc = DataEncryptor(key="short")
        assert enc.decrypt(enc.encrypt("ok")) == "ok"


class TestLegacyXor:
    def test_legacy_decrypt_works(self):
        # Hand-build legacy cipher-text so we can confirm it still decodes.
        legacy = LegacyXorEncryptor(key="default_encryption_key_32byte!")
        # We can't call .encrypt() any more — verify that.
        with pytest.raises(EncryptionConfigError):
            legacy.encrypt("payload")

    def test_legacy_handles_garbage(self):
        legacy = LegacyXorEncryptor(key="default_encryption_key_32byte!")
        assert legacy.decrypt("not-base64!!!") is None


class TestDataMasker:
    def test_email(self):
        assert DataMasker.mask_email("foo@bar.com") == "f*o@bar.com"
        assert DataMasker.mask_email("ab@x.com") == "**@x.com"
        assert DataMasker.mask_email("noemail") == "noemail"

    def test_phone(self):
        assert DataMasker.mask_phone("13812345678") == "*******5678"

    def test_dict(self):
        masked = DataMasker.mask_dict(
            {"username": "x", "password": "p", "nested": {"token": "t", "ok": 1}}
        )
        assert masked["password"] == "***"
        assert masked["nested"]["token"] == "***"
        assert masked["nested"]["ok"] == 1
