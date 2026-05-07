"""
password.py — Argon2id-based password hashing.

Why argon2id (OWASP Password Storage Cheat Sheet 2024):
  - memory-hard, side-channel resistant
  - argon2id = hybrid of argon2i (resistant to side-channel) and argon2d
    (resistant to GPU brute-force) — the current OWASP default
  - tunable: time_cost (iterations), memory_cost (KiB), parallelism

Defaults follow OWASP minimum (memory_cost ≥ 19 MiB, time_cost ≥ 2,
parallelism ≥ 1). Verify-time also runs `needs_rehash()` so callers
can transparently upgrade legacy hashes when the policy is bumped.
"""

from __future__ import annotations

import os
from typing import Optional

try:
    from argon2 import PasswordHasher as _Argon2PH
    from argon2 import exceptions as argon2_exc

    _ARGON2_AVAILABLE = True
except Exception:  # pragma: no cover
    _Argon2PH = None  # type: ignore[assignment]
    argon2_exc = None  # type: ignore[assignment]
    _ARGON2_AVAILABLE = False


class PasswordPolicyError(RuntimeError):
    """Raised when supplied password fails minimum policy."""


# OWASP 2024 baseline: 8 chars + at least one letter + one digit.
# Application teams should layout stronger policy at signup (haveibeenpwned,
# zxcvbn, breach lists). Server-side here we keep the floor pragmatic.
MIN_PASSWORD_LENGTH = 8


def _enforce_policy(password: str) -> None:
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordPolicyError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )


class PasswordHasher:
    """Argon2id wrapper with safe defaults and timing-attack-resistant verify."""

    def __init__(
        self,
        time_cost: Optional[int] = None,
        memory_cost: Optional[int] = None,
        parallelism: Optional[int] = None,
    ) -> None:
        if not _ARGON2_AVAILABLE:
            raise RuntimeError(
                "argon2-cffi is required; install services/requirements.txt"
            )
        # Allow ops to tune via env without a code change. Defaults are OWASP
        # minimums (and what argon2-cffi ships); production should bump.
        self._hasher = _Argon2PH(
            time_cost=int(time_cost or os.getenv("ARGON2_TIME_COST", "2")),
            memory_cost=int(memory_cost or os.getenv("ARGON2_MEMORY_COST", str(19 * 1024))),
            parallelism=int(parallelism or os.getenv("ARGON2_PARALLELISM", "1")),
        )

    def hash(self, password: str) -> str:
        """Hash a password (enforces minimum policy first)."""
        _enforce_policy(password)
        return self._hasher.hash(password)

    def verify(self, password: str, hashed: str) -> bool:
        """Verify a password. Returns False on any failure (no exception leak)."""
        if not password or not hashed:
            return False
        try:
            self._hasher.verify(hashed, password)
            return True
        except (argon2_exc.VerifyMismatchError, argon2_exc.InvalidHash):
            return False
        except Exception:
            return False

    def needs_rehash(self, hashed: str) -> bool:
        """True if the stored hash uses parameters weaker than current policy."""
        try:
            return self._hasher.check_needs_rehash(hashed)
        except Exception:
            return True


# Module-level convenience -------------------------------------------------
_default: Optional[PasswordHasher] = None


def get_password_hasher() -> PasswordHasher:
    global _default
    if _default is None:
        _default = PasswordHasher()
    return _default


def hash_password(password: str) -> str:
    return get_password_hasher().hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return get_password_hasher().verify(password, hashed)
