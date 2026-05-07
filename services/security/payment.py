"""
payment.py - Payment callback verification
"""

import hashlib
import hmac
import json
import time
import os
from typing import Dict, Optional, Tuple
from urllib.parse import parse_qs


class PaymentVerifier:
    """Verify payment callback signatures from various providers"""

    def __init__(self, secret_key: str = None):
        self.secret_key = secret_key or os.getenv(
            "PAYMENT_SECRET_KEY", "payment_secret"
        )

    def verify_hmac(
        self, data: dict, signature: str, provider: str = "custom"
    ) -> Tuple[bool, Optional[str]]:
        """Verify HMAC signature"""
        if not signature:
            return False, "Missing signature"

        try:
            expected = self._create_hmac_signature(data, provider)

            if not hmac.compare_digest(signature, expected):
                return False, "Signature mismatch"

            return True, None

        except Exception as e:
            return False, f"Verification error: {str(e)}"

    def _create_hmac_signature(self, data: dict, provider: str) -> str:
        """Create HMAC signature for data"""
        if provider == "custom":
            sorted_data = self._sort_dict(data)
            message = json.dumps(sorted_data, sort_keys=True)
        else:
            message = "&".join(f"{k}={data[k]}" for k in sorted(data.keys()))

        return hmac.new(
            self.secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
        ).hexdigest()

    def _sort_dict(self, d: dict) -> dict:
        """Sort dictionary recursively"""
        result = {}
        for key in sorted(d.keys()):
            value = d[key]
            if isinstance(value, dict):
                result[key] = self._sort_dict(value)
            else:
                result[key] = value
        return result

    def verify_timestamp(
        self, data: dict, max_age: int = 3600
    ) -> Tuple[bool, Optional[str]]:
        """Verify timestamp is not too old"""
        timestamp = data.get("timestamp") or data.get("time")

        if not timestamp:
            return False, "Missing timestamp"

        try:
            ts = int(timestamp)
            current = int(time.time())

            if abs(current - ts) > max_age:
                return False, "Callback too old"

            return True, None

        except (ValueError, TypeError):
            return False, "Invalid timestamp"

    def verify_amount(
        self, data: dict, expected_amount: float = None, tolerance: float = 0.01
    ) -> Tuple[bool, Optional[str]]:
        """Verify payment amount"""
        amount = data.get("amount") or data.get("total")

        if amount is None:
            return True, None

        try:
            actual = float(amount)

            if expected_amount is not None:
                if abs(actual - expected_amount) > tolerance:
                    return (
                        False,
                        f"Amount mismatch: expected {expected_amount}, got {actual}",
                    )

            if actual <= 0:
                return False, "Invalid amount"

            return True, None

        except (ValueError, TypeError):
            return False, "Invalid amount format"

    def verify_order_id(self, data: dict) -> Tuple[bool, Optional[str]]:
        """Verify order ID format"""
        order_id = (
            data.get("order_id") or data.get("orderId") or data.get("out_trade_no")
        )

        if not order_id:
            return False, "Missing order ID"

        if not isinstance(order_id, str) or len(order_id) < 6:
            return False, "Invalid order ID format"

        return True, None

    def verify_status(
        self, data: dict, valid_statuses: list = None
    ) -> Tuple[bool, Optional[str]]:
        """Verify payment status"""
        if valid_statuses is None:
            valid_statuses = ["success", "completed", "paid", "SUCCESS"]

        status = (
            data.get("status") or data.get("trade_status") or data.get("payment_status")
        )

        if not status:
            return False, "Missing status"

        if status not in valid_statuses:
            return False, f"Invalid status: {status}"

        return True, None

    def verify_callback(
        self,
        data: dict,
        signature: str,
        provider: str = "custom",
        check_timestamp: bool = True,
        check_amount: float = None,
        check_status: list = None,
    ) -> Tuple[bool, Optional[str], Optional[dict]]:
        """Complete callback verification"""

        valid, error = self.verify_hmac(data, signature, provider)
        if not valid:
            return False, error, None

        if check_timestamp:
            valid, error = self.verify_timestamp(data)
            if not valid:
                return False, error, None

        if check_amount is not None:
            valid, error = self.verify_amount(data, check_amount)
            if not valid:
                return False, error, None

        valid, error = self.verify_order_id(data)
        if not valid:
            return False, error, None

        if check_status is not None:
            valid, error = self.verify_status(data, check_status)
            if not valid:
                return False, error, None

        return True, None, self._extract_payment_info(data)


def verify_payment_callback(
    data: dict, signature: str, provider: str = "custom", **options
) -> Tuple[bool, Optional[str], Optional[dict]]:
    """Convenience function to verify payment callback"""
    verifier = PaymentVerifier()
    return verifier.verify_callback(data, signature, provider, **options)


class PaymentProvider:
    """Payment provider configuration"""

    PROVIDERS = {
        "apple": {
            "verify_status": ["SWORD", "SWORD_2"],
            "shared_secret_env": "APPLE_SHARED_SECRET",
        },
        "google": {
            "verify_status": ["charge_success"],
            "service_account_env": "GOOGLE_SERVICE_ACCOUNT",
        },
        "stripe": {
            "verify_status": ["succeeded"],
            "webhook_secret_env": "STRIPE_WEBHOOK_SECRET",
        },
        "custom": {
            "verify_status": ["success", "completed"],
            "secret_key_env": "PAYMENT_SECRET_KEY",
        },
    }

    @classmethod
    def get_verifier(cls, provider: str) -> PaymentVerifier:
        """Get verifier for provider"""
        return PaymentVerifier()


def create_payment_verification_middleware(secret_key: str = None):
    """Create Flask middleware for payment verification"""
    from flask import request, jsonify

    verifier = PaymentVerifier(secret_key)

    def middleware():
        if not request.path.startswith("/api/payment/callback"):
            return None

        signature = request.headers.get("X-Payment-Signature")
        data = request.get_json(silent=True) or {}

        if not signature:
            return jsonify({"error": "Missing signature"}), 400

        valid, error, payment_info = verifier.verify_callback(
            data,
            signature,
            provider="custom",
            check_timestamp=True,
            check_status=["success", "completed"],
        )

        if not valid:
            return jsonify({"error": error, "code": "INVALID_PAYMENT"}), 400

        request.payment_info = payment_info

        return None

    return middleware
