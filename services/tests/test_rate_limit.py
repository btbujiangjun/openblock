"""Tests for services.security.rate_limit (in-memory backend).

Redis backend tests are gated on a running redis server and live in
services/tests/integration/ (not added in this batch).

Covers:
  * InMemoryBackend allows up to `requests` then denies
  * Tokens recover over time
  * Block / unblock semantics
  * RateLimiter.set_limit / reset
"""

from __future__ import annotations

import time

import pytest

from services.security.rate_limit import (
    InMemoryBackend,
    RateLimitConfig,
    RateLimiter,
    reset_rate_limiter,
)


@pytest.fixture(autouse=True)
def _isolated_singleton():
    reset_rate_limiter()
    yield
    reset_rate_limiter()


def _build_limiter() -> RateLimiter:
    return RateLimiter(backend=InMemoryBackend())


class TestInMemoryBucket:
    def test_allows_up_to_requests(self):
        limiter = _build_limiter()
        limiter.set_limit("test", RateLimitConfig(requests=3, window=60))
        ident = "ip-1"
        for _ in range(3):
            allowed, info = limiter.check(ident, "test")
            assert allowed and info is None
        denied, info = limiter.check(ident, "test")
        assert not denied
        assert info["reason"] == "rate_limit"
        assert info["retry_after"] >= 1

    def test_independent_identifiers(self):
        limiter = _build_limiter()
        limiter.set_limit("test", RateLimitConfig(requests=1, window=60))
        a, _ = limiter.check("a", "test")
        b, _ = limiter.check("b", "test")
        assert a and b
        a2, _ = limiter.check("a", "test")
        assert not a2

    def test_tokens_recover(self):
        limiter = _build_limiter()
        # 6 req per 1s = 1 token every ~166ms
        limiter.set_limit("test", RateLimitConfig(requests=6, window=1))
        ident = "ip-x"
        for _ in range(6):
            assert limiter.check(ident, "test")[0]
        assert not limiter.check(ident, "test")[0]
        time.sleep(0.5)
        # After 0.5s ~ 3 tokens regenerated
        regenerated = sum(1 for _ in range(3) if limiter.check(ident, "test")[0])
        assert regenerated >= 1

    def test_block_unblock(self):
        limiter = _build_limiter()
        limiter.block("evil", duration=60)
        allowed, info = limiter.check("evil", "default")
        assert not allowed
        assert info["reason"] == "blocked"
        limiter.unblock("evil")
        allowed, _ = limiter.check("evil", "default")
        assert allowed

    def test_reset_clears_bucket(self):
        limiter = _build_limiter()
        limiter.set_limit("test", RateLimitConfig(requests=1, window=60))
        assert limiter.check("ip", "test")[0]
        assert not limiter.check("ip", "test")[0]
        limiter.reset("ip", "test")
        assert limiter.check("ip", "test")[0]

    def test_get_stats(self):
        limiter = _build_limiter()
        limiter.set_limit("t", RateLimitConfig(requests=2, window=60))
        for _ in range(3):
            limiter.check("ip", "t")
        stats = limiter.get_stats("ip", "t")
        assert stats["allowed"] >= 2
        assert stats["denied"] >= 1
        assert stats["limit"] == 2
