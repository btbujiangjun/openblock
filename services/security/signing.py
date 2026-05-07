"""
signing.py - Request signature validation
"""

import hashlib
import hmac
import time
import json
import base64
import os
from typing import Dict, Optional, Tuple


class RequestSigner:
    """Request signature creation and verification"""

    def __init__(self, secret_key: str = None):
        self.secret_key = secret_key or os.getenv(
            "API_SECRET_KEY", "default_secret_key"
        )
        self.algorithm = "SHA256"
        self.valid_window = 300  # 5 minutes

    def sign(
        self,
        method: str,
        path: str,
        params: dict = None,
        body: dict = None,
        timestamp: int = None,
    ) -> str:
        """Create signature for request"""
        if timestamp is None:
            timestamp = int(time.time())

        parts = [method.upper(), path, str(timestamp)]

        if params:
            sorted_params = self._sort_dict(params)
            parts.append(json.dumps(sorted_params, sort_keys=True))

        if body:
            sorted_body = self._sort_dict(body)
            parts.append(json.dumps(sorted_body, sort_keys=True))

        message = "|".join(parts)

        signature = hmac.new(
            self.secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256
        ).hexdigest()

        return f"{timestamp}.{signature}"

    def verify(
        self,
        signature: str,
        method: str,
        path: str,
        params: dict = None,
        body: dict = None,
    ) -> Tuple[bool, Optional[str]]:
        """Verify request signature"""
        if not signature:
            return False, "Missing signature"

        try:
            timestamp_str, sig = signature.split(".", 1)
            timestamp = int(timestamp_str)
        except (ValueError, AttributeError):
            return False, "Invalid signature format"

        current_time = int(time.time())
        if abs(current_time - timestamp) > self.valid_window:
            return False, "Signature expired"

        expected_sig = self.sign(method, path, params, body, timestamp)

        if not hmac.compare_digest(sig, expected_sig.split(".", 1)[1]):
            return False, "Signature mismatch"

        return True, None

    def _sort_dict(self, d: dict) -> dict:
        """Recursively sort dictionary for consistent signing"""
        if not isinstance(d, dict):
            return d

        result = {}
        for key in sorted(d.keys()):
            value = d[key]
            if isinstance(value, dict):
                result[key] = self._sort_dict(value)
            elif isinstance(value, list):
                result[key] = [
                    self._sort_dict(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                result[key] = value

        return result


def verify_request_signature(
    signature: str,
    method: str,
    path: str,
    params: dict = None,
    body: dict = None,
    secret_key: str = None,
) -> Tuple[bool, Optional[str]]:
    """Convenience function to verify request signature"""
    signer = RequestSigner(secret_key)
    return signer.verify(signature, method, path, params, body)


def create_signed_request(
    method: str,
    path: str,
    params: dict = None,
    body: dict = None,
    secret_key: str = None,
) -> Dict[str, str]:
    """Create a signed request dictionary"""
    signer = RequestSigner(secret_key)
    signature = signer.sign(method, path, params, body)

    return {
        "signature": signature,
        "method": method,
        "path": path,
        "params": params or {},
        "body": body,
    }


class RequestValidator:
    """Validate incoming requests"""

    def __init__(self, secret_key: str = None):
        self.signer = RequestSigner(secret_key)
        self.excluded_paths = {
            "/health",
            "/metrics",
            "/metrics/json",
            "/metrics/prometheus",
        }

    def should_sign(self, path: str) -> bool:
        """Check if path requires signature"""
        for excluded in self.excluded_paths:
            if path.startswith(excluded):
                return False
        return True

    def validate(
        self,
        signature: str,
        method: str,
        path: str,
        params: dict = None,
        body: dict = None,
    ) -> Tuple[bool, Optional[str]]:
        """Validate request with signature"""
        if not self.should_sign(path):
            return True, None

        return self.signer.verify(signature, method, path, params, body)


def create_signature_middleware(secret_key: str = None):
    """Create Flask middleware for signature validation"""
    from flask import request, jsonify

    validator = RequestValidator(secret_key)

    def middleware():
        if not validator.should_sign(request.path):
            return

        signature = request.headers.get("X-Signature")
        body = request.get_json(silent=True) or {}

        valid, error = validator.validate(
            signature, request.method, request.path, dict(request.args), body
        )

        if not valid:
            return jsonify({"error": error, "code": "INVALID_SIGNATURE"}), 401

    return middleware
