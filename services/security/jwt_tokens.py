"""
jwt_tokens.py — JSON Web Token (access + refresh) issuance & validation.

Why this module exists:
  v1.13's `user_service.app.login()` minted opaque random tokens that
  could never be revoked nor cross-validated by other services. v1.14
  ships PyJWT-backed access/refresh tokens with the following properties:

    - HS256 by default (single shared secret), with RS256 hook reserved
      for future asymmetric deployment (multi-region key distribution).
    - Configurable `iss` / `aud` so other services in the mesh can verify
      tokens issued by user-service without a shared DB.
    - Mandatory `exp` (access ≤ 1h, refresh ≤ 30d) and `iat` claims.
    - `jti` UUIDv4 enables denylist-based revocation; the denylist
      implementation is pluggable (default is in-memory; production
      should swap in a Redis-backed `RevocationStore`).
    - Refresh rotation: `refresh()` returns a NEW refresh token each time
      and revokes the previous one — defeats long-lived refresh-token
      replay attacks.

This module never reads the secret from a default value; missing
`JWT_SECRET` raises immediately so misconfigured deployments cannot ship.
"""

from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Set

try:
    import jwt as pyjwt
    from jwt.exceptions import (
        ExpiredSignatureError,
        InvalidTokenError,
        DecodeError,
    )

    _JWT_AVAILABLE = True
except Exception:  # pragma: no cover
    pyjwt = None  # type: ignore[assignment]
    ExpiredSignatureError = Exception  # type: ignore[assignment]
    InvalidTokenError = Exception  # type: ignore[assignment]
    DecodeError = Exception  # type: ignore[assignment]
    _JWT_AVAILABLE = False


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class JWTConfigError(RuntimeError):
    """Raised when JWT configuration is missing or invalid."""


class JWTError(RuntimeError):
    """Raised on token validation failure (expired, tampered, revoked)."""


# ---------------------------------------------------------------------------
# Revocation store interface (in-memory default; swap in Redis for prod)
# ---------------------------------------------------------------------------
class RevocationStore:
    """Pluggable storage for revoked `jti` values.

    Subclass this and pass an instance to `JWTManager` to back revocation
    with Redis / Postgres / etc. The default in-memory implementation is
    only safe for single-process dev/test.
    """

    def revoke(self, jti: str, expires_at: float) -> None:
        raise NotImplementedError

    def is_revoked(self, jti: str) -> bool:
        raise NotImplementedError


@dataclass
class InMemoryRevocationStore(RevocationStore):
    """Default in-memory denylist; entries are GC'd after expiry."""

    _store: dict[str, float] = field(default_factory=dict)

    def revoke(self, jti: str, expires_at: float) -> None:
        self._gc()
        self._store[jti] = expires_at

    def is_revoked(self, jti: str) -> bool:
        self._gc()
        return jti in self._store

    def _gc(self) -> None:
        now = time.time()
        # Iterate over a snapshot to allow mutation
        for jti, exp in list(self._store.items()):
            if exp <= now:
                del self._store[jti]


# ---------------------------------------------------------------------------
# JWT manager
# ---------------------------------------------------------------------------
@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    access_expires_at: int
    refresh_expires_at: int

    def to_dict(self) -> dict:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "access_expires_at": self.access_expires_at,
            "refresh_expires_at": self.refresh_expires_at,
            "token_type": "Bearer",
        }


class JWTManager:
    """Issue, verify, refresh and revoke JWT pairs."""

    def __init__(
        self,
        secret: Optional[str] = None,
        algorithm: str = "HS256",
        issuer: Optional[str] = None,
        audience: Optional[str] = None,
        access_ttl_seconds: Optional[int] = None,
        refresh_ttl_seconds: Optional[int] = None,
        revocation_store: Optional[RevocationStore] = None,
    ) -> None:
        if not _JWT_AVAILABLE:
            raise JWTConfigError(
                "PyJWT is required; install services/requirements.txt"
            )

        secret = secret or os.getenv("JWT_SECRET")
        if not secret:
            raise JWTConfigError(
                "JWT_SECRET env is required; generate with `openssl rand -hex 64`"
            )
        if len(secret) < 32:
            raise JWTConfigError(
                "JWT_SECRET must be at least 32 chars (256 bits)"
            )

        self._secret = secret
        self._algorithm = algorithm
        self._issuer = issuer or os.getenv("JWT_ISSUER", "openblock")
        self._audience = audience or os.getenv("JWT_AUDIENCE", "openblock-clients")
        self._access_ttl = int(
            access_ttl_seconds or os.getenv("JWT_ACCESS_TTL", "3600")
        )
        self._refresh_ttl = int(
            refresh_ttl_seconds or os.getenv("JWT_REFRESH_TTL", str(60 * 60 * 24 * 30))
        )
        if self._access_ttl <= 0 or self._access_ttl > 24 * 3600:
            raise JWTConfigError("JWT_ACCESS_TTL must be in (0, 86400] seconds")
        if self._refresh_ttl <= self._access_ttl:
            raise JWTConfigError("JWT_REFRESH_TTL must be greater than access TTL")

        self._revocation = revocation_store or InMemoryRevocationStore()

    # ------------------------------------------------------------------
    # Issuance
    # ------------------------------------------------------------------
    def issue(self, subject: str, *, scopes: Optional[list[str]] = None,
              extra_claims: Optional[dict] = None) -> TokenPair:
        """Mint a fresh access + refresh pair for `subject` (typically user_id)."""
        now = int(time.time())
        access_exp = now + self._access_ttl
        refresh_exp = now + self._refresh_ttl

        access_payload = {
            "sub": subject,
            "iss": self._issuer,
            "aud": self._audience,
            "iat": now,
            "exp": access_exp,
            "jti": str(uuid.uuid4()),
            "type": "access",
            "scope": " ".join(scopes or []),
        }
        if extra_claims:
            access_payload.update(extra_claims)

        refresh_payload = {
            "sub": subject,
            "iss": self._issuer,
            "aud": self._audience,
            "iat": now,
            "exp": refresh_exp,
            "jti": str(uuid.uuid4()),
            "type": "refresh",
        }

        access = pyjwt.encode(access_payload, self._secret, algorithm=self._algorithm)
        refresh = pyjwt.encode(refresh_payload, self._secret, algorithm=self._algorithm)
        return TokenPair(
            access_token=access if isinstance(access, str) else access.decode(),
            refresh_token=refresh if isinstance(refresh, str) else refresh.decode(),
            access_expires_at=access_exp,
            refresh_expires_at=refresh_exp,
        )

    # ------------------------------------------------------------------
    # Verification
    # ------------------------------------------------------------------
    def verify(self, token: str, *, expected_type: str = "access") -> dict:
        """Decode + validate token. Raises `JWTError` on any failure."""
        try:
            payload = pyjwt.decode(
                token,
                self._secret,
                algorithms=[self._algorithm],
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "iat", "sub", "jti", "iss", "aud"]},
            )
        except ExpiredSignatureError as exc:
            raise JWTError("Token expired") from exc
        except (InvalidTokenError, DecodeError) as exc:
            raise JWTError("Invalid token") from exc

        if payload.get("type") != expected_type:
            raise JWTError(
                f"Wrong token type: expected {expected_type}, got {payload.get('type')}"
            )
        if self._revocation.is_revoked(payload["jti"]):
            raise JWTError("Token revoked")
        return payload

    # ------------------------------------------------------------------
    # Refresh & revoke
    # ------------------------------------------------------------------
    def refresh(self, refresh_token: str, *, scopes: Optional[list[str]] = None) -> TokenPair:
        """Rotate a refresh token: revoke the old one, issue a new pair.

        This defeats long-lived refresh-token replay: any reuse of an
        already-rotated token will fail with "Token revoked".
        """
        payload = self.verify(refresh_token, expected_type="refresh")
        # Revoke the consumed refresh token; access tokens issued under
        # the old refresh still work until their own exp (kept simple).
        self._revocation.revoke(payload["jti"], payload["exp"])
        return self.issue(payload["sub"], scopes=scopes)

    def revoke(self, token: str) -> None:
        """Revoke any token (access or refresh) immediately."""
        try:
            payload = pyjwt.decode(
                token,
                self._secret,
                algorithms=[self._algorithm],
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "jti"]},
            )
        except Exception:
            return  # already invalid; nothing to revoke
        self._revocation.revoke(payload["jti"], payload["exp"])
