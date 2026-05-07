"""End-to-end-ish tests for services.user_service.app.

Uses the in-memory repo so we exercise the full route stack without
Postgres/Redis. Confirms:

  * /api/users 201 + password hashed (never returned)
  * weak password rejected
  * duplicate username rejected
  * /api/auth/login validates password and returns JWT pair
  * /api/auth/login wrong password returns generic 401
  * /api/auth/refresh rotates tokens and old refresh is revoked
  * /api/auth/verify accepts new tokens, rejects revoked
"""

from __future__ import annotations

import pytest

from services.security.jwt_tokens import InMemoryRevocationStore, JWTManager
from services.security.password import PasswordHasher
from services.user_service.app import _MemoryRepo, create_app


@pytest.fixture
def app():
    return create_app(
        user_repo=_MemoryRepo(),
        password_hasher=PasswordHasher(),
        jwt_manager=JWTManager(revocation_store=InMemoryRevocationStore()),
    )


@pytest.fixture
def client(app):
    return app.test_client()


def _signup(client, username="alice", password="CorrectHorseBatteryStaple"):
    return client.post(
        "/api/users",
        json={"username": username, "email": f"{username}@x.com", "password": password},
    )


class TestUserCreation:
    def test_create_ok(self, client):
        r = _signup(client)
        assert r.status_code == 201
        body = r.get_json()
        assert body["username"] == "alice"
        assert "password_hash" not in body
        assert "password" not in body

    def test_weak_password(self, client):
        r = client.post(
            "/api/users",
            json={"username": "a", "email": "a@x.com", "password": "short"},
        )
        assert r.status_code == 400
        assert r.get_json()["code"] == "WEAK_PASSWORD"

    def test_duplicate_username(self, client):
        _signup(client)
        r = _signup(client)
        assert r.status_code == 409
        assert r.get_json()["code"] == "USER_EXISTS"

    def test_missing_fields(self, client):
        r = client.post("/api/users", json={"username": "a"})
        assert r.status_code == 400


class TestAuth:
    def test_login_success(self, client):
        _signup(client)
        r = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "CorrectHorseBatteryStaple"},
        )
        assert r.status_code == 200
        body = r.get_json()
        assert body["token_type"] == "Bearer"
        assert body["access_token"] and body["refresh_token"]
        assert body["user"]["username"] == "alice"

    def test_login_wrong_password_generic(self, client):
        _signup(client)
        r = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "wrong-password-1234"},
        )
        assert r.status_code == 401
        assert r.get_json()["error"] == "Invalid credentials"

    def test_login_unknown_user_generic(self, client):
        r = client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "irrelevant-but-long"},
        )
        # Same response shape -> no user enumeration
        assert r.status_code == 401
        assert r.get_json()["error"] == "Invalid credentials"

    def test_refresh_rotation(self, client):
        _signup(client)
        login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "CorrectHorseBatteryStaple"},
        ).get_json()

        first_refresh = login["refresh_token"]
        r = client.post("/api/auth/refresh", json={"refresh_token": first_refresh})
        assert r.status_code == 200
        new_pair = r.get_json()
        assert new_pair["refresh_token"] != first_refresh

        # Replay: old refresh should be denied
        r2 = client.post("/api/auth/refresh", json={"refresh_token": first_refresh})
        assert r2.status_code == 401

    def test_verify_endpoint(self, client):
        _signup(client)
        login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "CorrectHorseBatteryStaple"},
        ).get_json()
        access = login["access_token"]
        r = client.post("/api/auth/verify", json={"token": access})
        assert r.status_code == 200
        assert r.get_json()["valid"] is True

    def test_logout_revokes_token(self, client):
        _signup(client)
        login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "CorrectHorseBatteryStaple"},
        ).get_json()
        access = login["access_token"]
        client.post("/api/auth/logout", json={"token": access})
        r = client.post("/api/auth/verify", json={"token": access})
        assert r.status_code == 401
