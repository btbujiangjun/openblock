"""Tests for services.security.password (argon2id).

Covers:
  * hash() returns argon2id-formatted prefix and verifies
  * verify() rejects wrong password / tampered hash without raising
  * weak passwords are rejected by policy
  * needs_rehash() flips True when policy is bumped
  * encryption.PasswordHasher delegates to argon2 when available
"""

from __future__ import annotations

import pytest

from services.security.password import (
    MIN_PASSWORD_LENGTH,
    PasswordHasher,
    PasswordPolicyError,
    hash_password,
    verify_password,
)


class TestPasswordHasher:
    def test_hash_and_verify_roundtrip(self):
        h = hash_password("CorrectHorseBatteryStaple")
        assert h.startswith("$argon2id$")
        assert verify_password("CorrectHorseBatteryStaple", h)

    def test_verify_wrong_password(self):
        h = hash_password("CorrectHorseBatteryStaple")
        assert not verify_password("wrong-password", h)

    def test_verify_tampered_hash(self):
        h = hash_password("CorrectHorseBatteryStaple")
        assert not verify_password("CorrectHorseBatteryStaple", h[:-1] + "0")

    def test_short_password_rejected(self):
        with pytest.raises(PasswordPolicyError):
            hash_password("short")

    def test_min_policy(self):
        # Boundary: exactly MIN length is OK
        pw = "x" * MIN_PASSWORD_LENGTH
        assert verify_password(pw, hash_password(pw))

    def test_needs_rehash_when_policy_bumped(self):
        weak = PasswordHasher(time_cost=1, memory_cost=8 * 1024, parallelism=1)
        h = weak.hash("CorrectHorseBatteryStaple")
        # Default hasher is stronger -> needs rehash
        assert PasswordHasher().needs_rehash(h)


class TestEncryptionPasswordHasherCompat:
    """The legacy PasswordHasher in encryption.py must delegate to argon2."""

    def test_delegates_to_argon2(self):
        from services.security.encryption import PasswordHasher as Legacy

        h = Legacy.hash_password("CorrectHorseBatteryStaple")
        assert h.startswith("$argon2id$")
        assert Legacy.verify_password("CorrectHorseBatteryStaple", h)
        assert not Legacy.verify_password("wrong", h)
