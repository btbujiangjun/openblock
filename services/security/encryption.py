"""
encryption.py — Sensitive data encryption.

v1.14 hardening:
  - Default encryption is now Fernet (AES-128-CBC + HMAC-SHA256) from
    `cryptography`, instead of the previous XOR-based obfuscation that
    accidentally shipped to `services/security/`.
  - The legacy XOR scheme is kept as `LegacyXorEncryptor` so existing
    cipher-text written by older builds can still be migrated; new code
    must NEVER instantiate it.
  - The encryption key is required (`ENCRYPTION_KEY` env). No default key
    fallback is allowed; missing key raises `EncryptionConfigError` at
    construction time, which is preferable to silently encrypting with a
    well-known constant.

Key handling:
  - `ENCRYPTION_KEY` should be a 32-byte url-safe base64 string (Fernet
    format). For convenience we also accept any 32+ byte raw secret which
    is then run through SHA-256 -> base64 to derive a Fernet-compatible
    key. The test suite covers both shapes.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any, Optional, Union

try:
    from cryptography.fernet import Fernet, InvalidToken

    _CRYPTOGRAPHY_AVAILABLE = True
except Exception:  # pragma: no cover - cryptography is a hard dep in services/requirements.txt
    Fernet = None  # type: ignore[assignment]
    InvalidToken = Exception  # type: ignore[assignment]
    _CRYPTOGRAPHY_AVAILABLE = False


class EncryptionConfigError(RuntimeError):
    """Raised when encryption configuration is missing or invalid."""


class EncryptionError(RuntimeError):
    """Raised on decrypt failure (tampered cipher-text / wrong key)."""


def _coerce_to_fernet_key(secret: str) -> bytes:
    """Convert any string secret into a 32-byte url-safe base64 key.

    Accepts:
      - already valid Fernet key (44 chars, base64 of 32 bytes)
      - raw secret of arbitrary length: SHA-256 -> base64 url-safe
    """
    if not secret:
        raise EncryptionConfigError("ENCRYPTION_KEY must not be empty")

    raw = secret.encode("utf-8")
    if len(raw) == 44:
        try:
            decoded = base64.urlsafe_b64decode(raw)
            if len(decoded) == 32:
                return raw
        except Exception:
            pass

    digest = hashlib.sha256(raw).digest()
    return base64.urlsafe_b64encode(digest)


class DataEncryptor:
    """Modern symmetric encryption for sensitive data (Fernet / AES-128)."""

    def __init__(self, key: Optional[str] = None):
        secret = key or os.getenv("ENCRYPTION_KEY")
        if not secret:
            raise EncryptionConfigError(
                "ENCRYPTION_KEY env is required for DataEncryptor; "
                "generate with `cryptography.fernet.Fernet.generate_key().decode()`"
            )
        if not _CRYPTOGRAPHY_AVAILABLE:
            raise EncryptionConfigError(
                "cryptography>=43 is required; install services/requirements.txt"
            )

        self._fernet = Fernet(_coerce_to_fernet_key(secret))

    def encrypt(self, data: Union[str, dict, list]) -> str:
        """Encrypt data, return url-safe base64 token (Fernet format)."""
        if isinstance(data, (dict, list)):
            data = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        token = self._fernet.encrypt(data.encode("utf-8"))
        return token.decode("ascii")

    def decrypt(self, encrypted_data: str) -> Union[dict, list, str]:
        """Decrypt token. Raises EncryptionError on tamper / wrong key."""
        try:
            plain = self._fernet.decrypt(encrypted_data.encode("ascii"))
        except InvalidToken as exc:
            raise EncryptionError("Invalid or tampered cipher-text") from exc
        text = plain.decode("utf-8")
        # Best-effort JSON detection: only treat as JSON when the payload
        # parses cleanly; otherwise return as plain string.
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text


def encrypt_sensitive_data(data: Union[str, dict, list], key: Optional[str] = None) -> str:
    """Convenience wrapper for one-off encryption."""
    return DataEncryptor(key).encrypt(data)


def decrypt_sensitive_data(
    encrypted_data: str, key: Optional[str] = None
) -> Union[dict, list, str]:
    """Convenience wrapper for one-off decryption.

    Raises EncryptionError if cipher-text is tampered or the key is wrong.
    """
    return DataEncryptor(key).decrypt(encrypted_data)


# ---------------------------------------------------------------------------
# Legacy XOR scheme — DO NOT USE FOR NEW WRITES.
# Kept only to allow rotation of historical cipher-text that was produced by
# the previous obfuscation. Callers must explicitly opt in.
# ---------------------------------------------------------------------------
class LegacyXorEncryptor:
    """Deprecated XOR + base64 obfuscation. Migration only.

    Provided for one-shot decryption of legacy values so they can be
    re-encrypted with `DataEncryptor`. Never use `encrypt()` here in new code.
    """

    def __init__(self, key: Optional[str] = None):
        secret = key or os.getenv("LEGACY_XOR_KEY") or "default_encryption_key_32byte!"
        if len(secret) < 32:
            secret = secret.ljust(32, "0")
        elif len(secret) > 32:
            secret = secret[:32]
        self._key = secret.encode("utf-8")

    def _xor(self, blob: bytes) -> bytes:
        result = bytearray()
        for i, b in enumerate(blob):
            result.append(b ^ self._key[i % len(self._key)])
        return bytes(result)

    def encrypt(self, data: Union[str, dict, list]) -> str:  # pragma: no cover
        raise EncryptionConfigError(
            "LegacyXorEncryptor.encrypt() is disabled; use DataEncryptor instead"
        )

    def decrypt(self, encrypted_data: str) -> Optional[Union[dict, str]]:
        try:
            blob = base64.b64decode(encrypted_data.encode())
            text = self._xor(blob).decode("utf-8")
        except Exception:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text


class TokenGenerator:
    """Secure token generation."""

    @staticmethod
    def generate_token(length: int = 32) -> str:
        """Generate secure random token. `length` is the *output* length in chars."""
        raw = os.urandom(max(length, 16))
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")[:length]

    @staticmethod
    def generate_api_key(prefix: str = "sk") -> str:
        """Generate API key with prefix."""
        return f"{prefix}_{TokenGenerator.generate_token(48)}"

    @staticmethod
    def hash_token(token: str) -> str:
        """Hash token for storage (one-way)."""
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def verify_token(token: str, hashed: str) -> bool:
        """Constant-time compare of token vs stored hash."""
        import hmac

        return hmac.compare_digest(TokenGenerator.hash_token(token), hashed)


class PasswordHasher:
    """Password hashing.

    PREFERRED: import `services.security.password.PasswordHasher` (argon2id).
    This PBKDF2-based class is kept for compatibility; new code should NOT
    reach into `encryption.PasswordHasher` directly. It now delegates to
    argon2 when available so legacy callers automatically get the upgrade.
    """

    @staticmethod
    def hash_password(password: str, salt: Optional[str] = None) -> str:
        try:
            from .password import PasswordHasher as _Argon2

            return _Argon2().hash(password)
        except Exception:
            # Fallback to PBKDF2-SHA256 100k iterations (still better than sha256)
            import hmac

            if salt is None:
                salt = os.urandom(32).hex()
            key = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000
            )
            return f"pbkdf2-sha256${salt}${base64.b64encode(key).decode()}"

    @staticmethod
    def verify_password(password: str, hashed: str) -> bool:
        try:
            from .password import PasswordHasher as _Argon2

            return _Argon2().verify(password, hashed)
        except Exception:
            import hmac

            try:
                if hashed.startswith("pbkdf2-sha256$"):
                    _, salt, key = hashed.split("$", 2)
                else:
                    salt, key = hashed.split("$", 1)
                expected = hashlib.pbkdf2_hmac(
                    "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000
                )
                return hmac.compare_digest(base64.b64encode(expected).decode(), key)
            except (ValueError, AttributeError):
                return False


class DataMasker:
    """Mask sensitive data for logging."""

    @staticmethod
    def mask_email(email: str) -> str:
        if not email or "@" not in email:
            return email
        local, domain = email.split("@", 1)
        if len(local) <= 2:
            masked_local = "*" * len(local)
        else:
            masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{masked_local}@{domain}"

    @staticmethod
    def mask_phone(phone: str) -> str:
        if not phone:
            return phone
        if len(phone) < 4:
            return "*" * len(phone)
        return "*" * (len(phone) - 4) + phone[-4:]

    @staticmethod
    def mask_card(card: str) -> str:
        if not card:
            return card
        if len(card) < 4:
            return "*" * len(card)
        return "*" * (len(card) - 4) + card[-4:]

    @staticmethod
    def mask_dict(data: dict, sensitive_keys: Optional[list] = None) -> dict:
        if sensitive_keys is None:
            sensitive_keys = [
                "password",
                "secret",
                "token",
                "key",
                "credit_card",
                "ssn",
                "phone",
                "email",
                "address",
            ]

        result: dict[str, Any] = {}
        for key, value in data.items():
            if any(s in key.lower() for s in sensitive_keys):
                if key.lower() == "email" and value:
                    result[key] = DataMasker.mask_email(value)
                elif key.lower() == "phone" and value:
                    result[key] = DataMasker.mask_phone(value)
                else:
                    result[key] = "***"
            elif isinstance(value, dict):
                result[key] = DataMasker.mask_dict(value, sensitive_keys)
            else:
                result[key] = value
        return result
