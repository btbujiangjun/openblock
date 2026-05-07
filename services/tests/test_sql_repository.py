"""Tests for SqlUserRepository (uses sqlite in-memory backend).

Validates that the SQL-backed repo behaves identically to the in-memory
one for the operations the service relies on:
  * create / get_by_username / get_by_id roundtrip
  * duplicate username raises ValueError (mapped to HTTP 409 by route)
  * the route layer continues to work end-to-end when wired with SQL repo
"""

from __future__ import annotations

import pytest

from services.common.orm import build_engine
from services.security.jwt_tokens import InMemoryRevocationStore, JWTManager
from services.security.password import PasswordHasher
from services.user_service.app import create_app
from services.user_service.sql_repository import SqlUserRepository


@pytest.fixture
def repo():
    engine = build_engine("sqlite:///:memory:")
    r = SqlUserRepository(engine)
    r.create_schema()
    return r


@pytest.fixture
def app_with_sql(repo):
    return create_app(
        user_repo=repo,
        password_hasher=PasswordHasher(),
        jwt_manager=JWTManager(revocation_store=InMemoryRevocationStore()),
    )


class TestRepositoryDirect:
    def test_create_and_lookup(self, repo):
        rec = repo.create(
            username="bob",
            email="bob@example.com",
            password_hash="$argon2id$test",
        )
        assert rec["id"]
        assert rec["username"] == "bob"
        assert repo.get_by_username("bob")["id"] == rec["id"]
        assert repo.get_by_id(rec["id"])["username"] == "bob"

    def test_get_missing_returns_none(self, repo):
        assert repo.get_by_username("ghost") is None
        assert repo.get_by_id("00000000-0000-0000-0000-000000000000") is None

    def test_duplicate_username_raises(self, repo):
        repo.create(username="bob", email="b@x.com", password_hash="x")
        with pytest.raises(ValueError):
            repo.create(username="bob", email="b2@x.com", password_hash="x")


class TestRouteLayerWithSqlRepo:
    """End-to-end: same flow as test_user_service.py but with SQL backing."""

    def test_signup_and_login(self, app_with_sql):
        client = app_with_sql.test_client()
        r = client.post(
            "/api/users",
            json={
                "username": "alice",
                "email": "alice@x.com",
                "password": "CorrectHorseBatteryStaple",
            },
        )
        assert r.status_code == 201

        r2 = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "CorrectHorseBatteryStaple"},
        )
        assert r2.status_code == 200
        body = r2.get_json()
        assert body["access_token"]
        assert body["refresh_token"]
