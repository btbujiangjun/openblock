"""Tests for services.security.jwt_tokens.

Covers:
  * issue() returns access + refresh with required claims and exp
  * verify() rejects wrong type, tampered, expired tokens
  * refresh() rotates jti and revokes old refresh token
  * revoke() blocks subsequent verify
  * Missing JWT_SECRET raises JWTConfigError
  * Short secret raises JWTConfigError
"""

from __future__ import annotations

import time

import jwt as pyjwt
import pytest

from services.security.jwt_tokens import (
    InMemoryRevocationStore,
    JWTConfigError,
    JWTError,
    JWTManager,
)


@pytest.fixture
def manager():
    return JWTManager(revocation_store=InMemoryRevocationStore())


class TestIssueAndVerify:
    def test_issue_returns_pair(self, manager):
        pair = manager.issue("user-1", scopes=["play"])
        assert pair.access_token and pair.refresh_token
        assert pair.access_expires_at > time.time()
        assert pair.refresh_expires_at > pair.access_expires_at

    def test_verify_access(self, manager):
        pair = manager.issue("user-1")
        payload = manager.verify(pair.access_token)
        assert payload["sub"] == "user-1"
        assert payload["type"] == "access"
        assert "jti" in payload

    def test_verify_rejects_refresh_when_access_expected(self, manager):
        pair = manager.issue("user-1")
        with pytest.raises(JWTError):
            manager.verify(pair.refresh_token, expected_type="access")

    def test_verify_tampered(self, manager):
        pair = manager.issue("user-1")
        with pytest.raises(JWTError):
            manager.verify(pair.access_token + "x")


class TestRefreshRotation:
    def test_refresh_returns_new_pair(self, manager):
        pair = manager.issue("user-1")
        new = manager.refresh(pair.refresh_token)
        assert new.refresh_token != pair.refresh_token
        assert new.access_token != pair.access_token

    def test_old_refresh_blocked_after_rotation(self, manager):
        pair = manager.issue("user-1")
        manager.refresh(pair.refresh_token)
        with pytest.raises(JWTError):
            manager.refresh(pair.refresh_token)


class TestRevocation:
    def test_revoke_blocks_verify(self, manager):
        pair = manager.issue("user-1")
        manager.revoke(pair.access_token)
        with pytest.raises(JWTError):
            manager.verify(pair.access_token)

    def test_revoke_invalid_token_is_noop(self, manager):
        # Should not raise
        manager.revoke("not.a.jwt")


class TestConfig:
    def test_missing_secret_raises(self, monkeypatch):
        monkeypatch.delenv("JWT_SECRET", raising=False)
        with pytest.raises(JWTConfigError):
            JWTManager()

    def test_short_secret_raises(self, monkeypatch):
        monkeypatch.setenv("JWT_SECRET", "short")
        with pytest.raises(JWTConfigError):
            JWTManager()

    def test_invalid_ttls_raise(self, monkeypatch):
        with pytest.raises(JWTConfigError):
            JWTManager(access_ttl_seconds=10, refresh_ttl_seconds=5)
        with pytest.raises(JWTConfigError):
            JWTManager(access_ttl_seconds=0, refresh_ttl_seconds=10)


class TestExpiredToken:
    def test_expired_access_rejected(self, monkeypatch):
        # Build a manager with a 1s access TTL, mint, sleep, expect failure.
        mgr = JWTManager(access_ttl_seconds=1, refresh_ttl_seconds=86400)
        pair = mgr.issue("user-1")
        # Forcibly fast-forward by re-decoding with `leeway=-2`.
        # Using PyJWT directly: build a token already expired.
        expired = pyjwt.encode(
            {
                "sub": "u",
                "iss": "openblock",
                "aud": "openblock-clients",
                "iat": int(time.time()) - 10,
                "exp": int(time.time()) - 1,
                "jti": "x",
                "type": "access",
            },
            mgr._secret,  # type: ignore[attr-defined]
            algorithm="HS256",
        )
        with pytest.raises(JWTError):
            mgr.verify(expired if isinstance(expired, str) else expired.decode())
