"""
rate_limit.py - Rate limiting system
"""

import time
import os
from collections import defaultdict
from typing import Dict, Optional, Tuple
from datetime import datetime, timedelta


class RateLimitConfig:
    """Rate limit configuration"""

    def __init__(self, requests: int = 100, window: int = 60, burst: int = None):
        self.requests = requests
        self.window = window
        self.burst = burst or requests


class RateLimiter:
    """Token bucket rate limiter with in-memory storage"""

    def __init__(self):
        self._limits: Dict[str, RateLimitConfig] = {}
        self._buckets: Dict[str, Dict] = defaultdict(
            lambda: {"tokens": 0, "last_update": time.time()}
        )
        self._history: Dict[str, list] = defaultdict(list)
        self._blocked: Dict[str, float] = {}

        self._setup_default_limits()

    def _setup_default_limits(self):
        """Setup default rate limits"""
        self.set_limit("default", RateLimitConfig(requests=100, window=60))
        self.set_limit("api", RateLimitConfig(requests=1000, window=60))
        self.set_limit("auth", RateLimitConfig(requests=10, window=60))
        self.set_limit("payment", RateLimitConfig(requests=20, window=60))
        self.set_limit("game", RateLimitConfig(requests=200, window=60))

    def set_limit(self, key: str, config: RateLimitConfig):
        """Set rate limit for a key"""
        self._limits[key] = config

    def check(
        self, identifier: str, limit_key: str = "default"
    ) -> Tuple[bool, Optional[Dict]]:
        """Check if request is allowed"""
        if self._is_blocked(identifier):
            return False, {
                "reason": "blocked",
                "blocked_until": self._blocked.get(identifier),
            }

        config = self._limits.get(limit_key, self._limits["default"])

        bucket_key = f"{limit_key}:{identifier}"
        bucket = self._buckets[bucket_key]

        now = time.time()
        elapsed = now - bucket["last_update"]

        tokens = bucket["tokens"]
        tokens = min(config.burst, tokens + elapsed * (config.requests / config.window))

        if tokens >= 1:
            tokens -= 1
            bucket["tokens"] = tokens
            bucket["last_update"] = now

            self._record_request(identifier, limit_key, True)

            return True, None
        else:
            self._record_request(identifier, limit_key, False)

            retry_after = (1 - tokens) * (config.window / config.requests)

            return False, {
                "reason": "rate_limit",
                "limit": config.requests,
                "window": config.window,
                "retry_after": int(retry_after),
            }

    def _is_blocked(self, identifier: str) -> bool:
        """Check if identifier is blocked"""
        if identifier in self._blocked:
            if time.time() > self._blocked[identifier]:
                del self._blocked[identifier]
                return False
            return True
        return False

    def block(self, identifier: str, duration: int = 300):
        """Block identifier for duration seconds"""
        self._blocked[identifier] = time.time() + duration

    def unblock(self, identifier: str):
        """Unblock identifier"""
        if identifier in self._blocked:
            del self._blocked[identifier]

    def _record_request(self, identifier: str, limit_key: str, allowed: bool):
        """Record request for history"""
        key = f"{limit_key}:{identifier}"
        timestamp = time.time()

        self._history[key].append({"timestamp": timestamp, "allowed": allowed})

        cutoff = timestamp - 3600
        self._history[key] = [r for r in self._history[key] if r["timestamp"] > cutoff]

    def get_stats(self, identifier: str, limit_key: str = "default") -> Dict:
        """Get rate limit stats for identifier"""
        key = f"{limit_key}:{identifier}"

        history = self._history.get(key, [])
        allowed_count = sum(1 for r in history if r["allowed"])
        denied_count = len(history) - allowed_count

        config = self._limits.get(limit_key, self._limits["default"])

        return {
            "allowed": allowed_count,
            "denied": denied_count,
            "limit": config.requests,
            "window": config.window,
            "is_blocked": self._is_blocked(identifier),
        }

    def reset(self, identifier: str = None, limit_key: str = None):
        """Reset rate limit counters"""
        if identifier and limit_key:
            key = f"{limit_key}:{identifier}"
            if key in self._buckets:
                del self._buckets[key]
            if key in self._history:
                del self._history[key]
        elif identifier:
            keys_to_delete = [
                k for k in self._buckets.keys() if k.endswith(f":{identifier}")
            ]
            for key in keys_to_delete:
                del self._buckets[key]
                if key in self._history:
                    del self._history[key]
        else:
            self._buckets.clear()
            self._history.clear()


_rate_limiter = None


def get_rate_limiter() -> RateLimiter:
    """Get global rate limiter instance"""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter


def check_rate_limit(
    identifier: str, limit_key: str = "default"
) -> Tuple[bool, Optional[Dict]]:
    """Convenience function to check rate limit"""
    return get_rate_limiter().check(identifier, limit_key)


def get_rate_limit_info(identifier: str, limit_key: str = "default") -> Dict:
    """Get rate limit info for identifier"""
    return get_rate_limiter().get_stats(identifier, limit_key)


def create_rate_limit_middleware(limit_key: str = "api", identifier_func=None):
    """Create Flask middleware for rate limiting"""
    from flask import request, jsonify

    limiter = get_rate_limiter()

    def middleware():
        if identifier_func:
            identifier = identifier_func(request)
        else:
            identifier = request.remote_addr or "unknown"

        allowed, info = limiter.check(identifier, limit_key)

        if not allowed:
            response = jsonify(
                {
                    "error": "Rate limit exceeded",
                    "code": "RATE_LIMIT_EXCEEDED",
                    "retry_after": info.get("retry_after", 60),
                }
            )
            response.headers["Retry-After"] = str(info.get("retry_after", 60))
            response.headers["X-RateLimit-Limit"] = str(info.get("limit", 100))
            response.headers["X-RateLimit-Remaining"] = "0"
            return response, 429

        return None

    return middleware
