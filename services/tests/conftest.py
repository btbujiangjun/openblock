"""Common pytest fixtures for services/* tests.

We set required env vars (JWT secret, encryption key, payment secret) once
per test session so the security modules construct cleanly. Each suite
that needs to test the *missing-env* branch overrides via monkeypatch.
"""

from __future__ import annotations

import os

import pytest

# Make sure `services.*` imports work when running pytest from repo root.
# (`PYTHONPATH=.` is set automatically by python's site logic, but we make
# it explicit so test discovery via `python -m pytest services/tests` also
# works in CI without needing the user to set anything.)
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


@pytest.fixture(autouse=True)
def _security_env(monkeypatch):
    """Provide non-default secrets for every test."""
    monkeypatch.setenv(
        "ENCRYPTION_KEY",
        # Fernet sample key (44 chars, base64 of 32 bytes). Generated via
        # `Fernet.generate_key().decode()` and committed only because the
        # test suite needs a deterministic key; PROD must use a real key.
        "kQjBQMnZx3rBe-2N0xyq7P_Y-2nE2Vf7TQjN5rSp5x0=",
    )
    monkeypatch.setenv(
        "JWT_SECRET",
        # 64-char hex; tests only.
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    monkeypatch.setenv(
        "PAYMENT_SECRET_KEY",
        "test_payment_secret_must_be_at_least_32_characters_long",
    )
    yield
