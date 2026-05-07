"""
encryption.py - Sensitive data encryption
"""

import base64
import hashlib
import os
import json
from typing import Optional, Union


class DataEncryptor:
    """Encryption for sensitive data - simple base64 + hash for fallback"""

    def __init__(self, key: str = None):
        self.key = key or os.getenv("ENCRYPTION_KEY", "default_encryption_key_32byte!")
        if len(self.key) < 32:
            self.key = self.key.ljust(32, "0")
        elif len(self.key) > 32:
            self.key = self.key[:32]

    def encrypt(self, data: Union[str, dict, list]) -> str:
        """Encrypt data"""
        if isinstance(data, (dict, list)):
            data = json.dumps(data)
        data_bytes = data.encode("utf-8")

        # Simple XOR-based encryption
        key_bytes = self.key.encode("utf-8")
        result = bytearray()
        key_idx = 0
        for byte in data_bytes:
            result.append(byte ^ key_bytes[key_idx % len(key_bytes)])
            key_idx += 1

        return base64.b64encode(bytes(result)).decode()

    def decrypt(self, encrypted_data: str) -> Optional[Union[dict, str]]:
        """Decrypt data"""
        try:
            encrypted = base64.b64decode(encrypted_data.encode())
            key_bytes = self.key.encode("utf-8")

            result = bytearray()
            key_idx = 0
            for byte in encrypted:
                result.append(byte ^ key_bytes[key_idx % len(key_bytes)])
                key_idx += 1

            result_str = bytes(result).decode("utf-8")

            try:
                return json.loads(result_str)
            except json.JSONDecodeError:
                return result_str
        except Exception as e:
            return None


def encrypt_sensitive_data(data: Union[str, dict, list], key: str = None) -> str:
    """Convenience function to encrypt data"""
    return DataEncryptor(key).encrypt(data)


def decrypt_sensitive_data(
    encrypted_data: str, key: str = None
) -> Optional[Union[dict, str]]:
    """Convenience function to decrypt data"""
    return DataEncryptor(key).decrypt(encrypted_data)


class TokenGenerator:
    """Secure token generation"""

    @staticmethod
    def generate_token(length: int = 32) -> str:
        """Generate secure random token"""
        return base64.urlsafe_b64encode(os.urandom(length)).decode()[:length]

    @staticmethod
    def generate_api_key(prefix: str = "sk") -> str:
        """Generate API key with prefix"""
        return f"{prefix}_{TokenGenerator.generate_token(48)}"

    @staticmethod
    def hash_token(token: str) -> str:
        """Hash token for storage"""
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def verify_token(token: str, hashed: str) -> bool:
        """Verify token against hash"""
        import hmac

        return hmac.compare_digest(TokenGenerator.hash_token(token), hashed)


class PasswordHasher:
    """Secure password hashing"""

    @staticmethod
    def hash_password(password: str, salt: str = None) -> str:
        """Hash password with salt"""
        import hmac

        if salt is None:
            salt = os.urandom(32).hex()
        key = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000
        )
        return f"{salt}${base64.b64encode(key).decode()}"

    @staticmethod
    def verify_password(password: str, hashed: str) -> bool:
        """Verify password against hash"""
        import hmac

        try:
            salt, key = hashed.split("$")
            expected_key = hashlib.pbkdf2_hmac(
                "sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000
            )
            return hmac.compare_digest(base64.b64encode(expected_key).decode(), key)
        except (ValueError, AttributeError):
            return False


class DataMasker:
    """Mask sensitive data for logging"""

    @staticmethod
    def mask_email(email: str) -> str:
        """Mask email address"""
        if not email or "@" not in email:
            return email
        local, domain = email.split("@")
        if len(local) <= 2:
            masked_local = "*" * len(local)
        else:
            masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
        return f"{masked_local}@{domain}"

    @staticmethod
    def mask_phone(phone: str) -> str:
        """Mask phone number"""
        if not phone:
            return phone
        if len(phone) < 4:
            return "*" * len(phone)
        return "*" * (len(phone) - 4) + phone[-4:]

    @staticmethod
    def mask_card(card: str) -> str:
        """Mask credit card"""
        if not card:
            return card
        if len(card) < 4:
            return "*" * len(card)
        return "*" * (len(card) - 4) + card[-4:]

    @staticmethod
    def mask_dict(data: dict, sensitive_keys: list = None) -> dict:
        """Mask sensitive fields in dictionary"""
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

        result = {}
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
