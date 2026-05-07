"""
rate_limit.py — Token-bucket rate limiter with pluggable backend.

v1.14 hardening:
  - Previous implementation kept buckets in a process-local dict, which
    means a multi-replica deployment had no shared limit state — an
    attacker could spread requests across replicas (or wait for a
    restart) to bypass throttling.
  - This module now exposes a `RateLimitBackend` interface; the default
    `InMemoryBackend` keeps the old behavior for dev/test, while
    `RedisBackend` runs the bucket math atomically inside Redis (single
    EVAL) so all replicas share the same state.
  - Production should always use `RedisBackend` (or front the cluster
    with nginx/Cloudflare limit_req); the default in-memory backend
    raises a deprecation warning once per process.

The scoring algorithm is a leaky-bucket / token-bucket hybrid:
  tokens_now = min(burst, tokens_prev + elapsed * (rate/window))
  if tokens_now >= 1:  consume 1, allow
  else:                deny, retry_after = (1 - tokens_now) * window/rate
"""

from __future__ import annotations

import os
import time
import warnings
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Optional, Protocol, Tuple


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@dataclass
class RateLimitConfig:
    """Limit configuration for a named bucket family."""

    requests: int = 100
    window: int = 60  # seconds
    burst: Optional[int] = None  # default: burst == requests

    @property
    def effective_burst(self) -> int:
        return self.burst if self.burst is not None else self.requests


# ---------------------------------------------------------------------------
# Backend interface
# ---------------------------------------------------------------------------
class RateLimitBackend(Protocol):
    """Pluggable storage / atomic-update layer for the limiter."""

    def take(
        self, key: str, config: RateLimitConfig
    ) -> Tuple[bool, float]:  # (allowed, tokens_remaining_or_negative)
        ...

    def reset(self, key: Optional[str] = None) -> None:
        ...


@dataclass
class InMemoryBackend:
    """Single-process bucket storage. Safe ONLY for dev/test.

    Buckets start full (`tokens == burst`) so the first burst of requests
    is allowed immediately — same as the Redis Lua implementation below
    when keys are absent.
    """

    _buckets: Dict[str, Dict[str, float]] = field(default_factory=dict)
    _warned: bool = False

    def _warn_once(self) -> None:
        if not self._warned and os.getenv("RATE_LIMIT_BACKEND", "memory") == "memory":
            warnings.warn(
                "rate_limit: using InMemoryBackend; switch to RedisBackend "
                "for multi-replica deployments (set RATE_LIMIT_BACKEND=redis).",
                stacklevel=3,
            )
            self._warned = True

    def take(self, key: str, config: RateLimitConfig) -> Tuple[bool, float]:
        self._warn_once()
        now = time.time()
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = {"tokens": float(config.effective_burst), "last_update": now}
            self._buckets[key] = bucket
        elapsed = max(0.0, now - bucket["last_update"])
        tokens = min(
            config.effective_burst,
            bucket["tokens"] + elapsed * (config.requests / max(config.window, 1)),
        )
        if tokens >= 1.0:
            tokens -= 1.0
            bucket["tokens"] = tokens
            bucket["last_update"] = now
            return True, tokens
        bucket["tokens"] = tokens
        bucket["last_update"] = now
        return False, tokens

    def reset(self, key: Optional[str] = None) -> None:
        if key is None:
            self._buckets.clear()
        else:
            self._buckets.pop(key, None)


class RedisBackend:
    """Redis-backed atomic token-bucket using a single EVAL script.

    Lua keeps the read+write atomic, removing the race that would
    otherwise let concurrent requests over-spend the bucket.
    """

    _LUA = """
    local tokens_key = KEYS[1]
    local rate     = tonumber(ARGV[1])
    local window   = tonumber(ARGV[2])
    local burst    = tonumber(ARGV[3])
    local now      = tonumber(ARGV[4])

    local data = redis.call('HMGET', tokens_key, 'tokens', 'last_update')
    -- New buckets start full (tokens == burst) so the first burst of
    -- requests is allowed; mirrors the in-memory backend's semantics.
    local tokens = tonumber(data[1]) or burst
    local last   = tonumber(data[2]) or now
    local elapsed = math.max(0, now - last)
    tokens = math.min(burst, tokens + elapsed * (rate / math.max(window, 1)))

    local allowed = 0
    if tokens >= 1 then
      tokens = tokens - 1
      allowed = 1
    end

    redis.call('HMSET', tokens_key, 'tokens', tokens, 'last_update', now)
    redis.call('EXPIRE', tokens_key, window * 2)
    return {allowed, tostring(tokens)}
    """

    def __init__(self, redis_client=None):
        self._redis = redis_client or self._build_default()
        self._script_sha = None

    @staticmethod
    def _build_default():
        try:
            import redis  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "redis-py is required for RedisBackend; install services/requirements.txt"
            ) from exc

        host = os.getenv("REDIS_HOST", "127.0.0.1")
        port = int(os.getenv("REDIS_PORT", "6379"))
        password = os.getenv("REDIS_PASSWORD") or None
        db = int(os.getenv("REDIS_DB", "0"))
        return redis.Redis(host=host, port=port, password=password, db=db, decode_responses=True)

    def _ensure_script(self):
        if self._script_sha is None:
            self._script_sha = self._redis.script_load(self._LUA)
        return self._script_sha

    def take(self, key: str, config: RateLimitConfig) -> Tuple[bool, float]:
        sha = self._ensure_script()
        now = time.time()
        result = self._redis.evalsha(
            sha,
            1,
            f"rl:{key}",
            config.requests,
            config.window,
            config.effective_burst,
            now,
        )
        allowed = int(result[0]) == 1
        tokens = float(result[1])
        return allowed, tokens

    def reset(self, key: Optional[str] = None) -> None:
        if key is None:
            for k in self._redis.scan_iter("rl:*"):
                self._redis.delete(k)
        else:
            self._redis.delete(f"rl:{key}")


# ---------------------------------------------------------------------------
# Limiter (backend-agnostic)
# ---------------------------------------------------------------------------
class RateLimiter:
    """Token bucket rate limiter; choose backend via env or DI."""

    def __init__(self, backend: Optional[RateLimitBackend] = None):
        self._limits: Dict[str, RateLimitConfig] = {}
        self._blocked: Dict[str, float] = {}
        self._history: Dict[str, list] = defaultdict(list)
        self._backend = backend or self._auto_backend()
        self._setup_default_limits()

    @staticmethod
    def _auto_backend() -> RateLimitBackend:
        kind = os.getenv("RATE_LIMIT_BACKEND", "memory").lower()
        if kind == "redis":
            return RedisBackend()
        return InMemoryBackend()

    def _setup_default_limits(self):
        self.set_limit("default", RateLimitConfig(requests=100, window=60))
        self.set_limit("api", RateLimitConfig(requests=1000, window=60))
        self.set_limit("auth", RateLimitConfig(requests=10, window=60))
        self.set_limit("payment", RateLimitConfig(requests=20, window=60))
        self.set_limit("game", RateLimitConfig(requests=200, window=60))

    def set_limit(self, key: str, config: RateLimitConfig):
        self._limits[key] = config

    def check(self, identifier: str, limit_key: str = "default") -> Tuple[bool, Optional[Dict]]:
        if self._is_blocked(identifier):
            return False, {
                "reason": "blocked",
                "blocked_until": self._blocked.get(identifier),
            }

        config = self._limits.get(limit_key, self._limits["default"])
        bucket_key = f"{limit_key}:{identifier}"
        allowed, tokens = self._backend.take(bucket_key, config)

        self._record_request(identifier, limit_key, allowed)

        if allowed:
            return True, None

        retry_after = max(1, int((1 - tokens) * (config.window / max(config.requests, 1))))
        return False, {
            "reason": "rate_limit",
            "limit": config.requests,
            "window": config.window,
            "retry_after": retry_after,
        }

    def _is_blocked(self, identifier: str) -> bool:
        if identifier in self._blocked:
            if time.time() > self._blocked[identifier]:
                del self._blocked[identifier]
                return False
            return True
        return False

    def block(self, identifier: str, duration: int = 300):
        self._blocked[identifier] = time.time() + duration

    def unblock(self, identifier: str):
        self._blocked.pop(identifier, None)

    def _record_request(self, identifier: str, limit_key: str, allowed: bool):
        key = f"{limit_key}:{identifier}"
        ts = time.time()
        self._history[key].append({"timestamp": ts, "allowed": allowed})
        cutoff = ts - 3600
        self._history[key] = [r for r in self._history[key] if r["timestamp"] > cutoff]

    def get_stats(self, identifier: str, limit_key: str = "default") -> Dict:
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
        if identifier and limit_key:
            key = f"{limit_key}:{identifier}"
            self._backend.reset(key)
            self._history.pop(key, None)
        else:
            self._backend.reset()
            self._history.clear()


# Module singletons --------------------------------------------------------
_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter


def reset_rate_limiter() -> None:
    """Test helper: drop the singleton so the next call rebuilds with current env."""
    global _rate_limiter
    _rate_limiter = None


def check_rate_limit(identifier: str, limit_key: str = "default") -> Tuple[bool, Optional[Dict]]:
    return get_rate_limiter().check(identifier, limit_key)


def get_rate_limit_info(identifier: str, limit_key: str = "default") -> Dict:
    return get_rate_limiter().get_stats(identifier, limit_key)


def create_rate_limit_middleware(limit_key: str = "api", identifier_func=None):
    """Create Flask middleware for rate limiting."""
    from flask import request, jsonify

    limiter = get_rate_limiter()

    def middleware():
        identifier = (
            identifier_func(request) if identifier_func else (request.remote_addr or "unknown")
        )
        allowed, info = limiter.check(identifier, limit_key)
        if not allowed:
            response = jsonify(
                {
                    "error": "Rate limit exceeded",
                    "code": "RATE_LIMIT_EXCEEDED",
                    "retry_after": info.get("retry_after", 60) if info else 60,
                }
            )
            response.headers["Retry-After"] = str(info.get("retry_after", 60) if info else 60)
            response.headers["X-RateLimit-Limit"] = str(info.get("limit", 100) if info else 100)
            response.headers["X-RateLimit-Remaining"] = "0"
            return response, 429
        return None

    return middleware
