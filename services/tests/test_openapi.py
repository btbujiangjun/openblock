"""Tests for the user_service OpenAPI endpoints.

Asserts:
  * /openapi.json returns a valid OpenAPI 3 document with the routes
    we declared via YAML docstrings.
  * /docs returns the Swagger UI HTML shell.
  * Spec component schemas include our marshmallow schemas.
"""

from __future__ import annotations

import json

import pytest

from services.security.jwt_tokens import InMemoryRevocationStore, JWTManager
from services.security.password import PasswordHasher
from services.user_service.app import _MemoryRepo, create_app


@pytest.fixture
def client():
    app = create_app(
        user_repo=_MemoryRepo(),
        password_hasher=PasswordHasher(),
        jwt_manager=JWTManager(revocation_store=InMemoryRevocationStore()),
    )
    return app.test_client()


class TestOpenAPI:
    def test_openapi_json_served(self, client):
        r = client.get("/openapi.json")
        assert r.status_code == 200
        spec = json.loads(r.get_data(as_text=True))
        assert spec["openapi"].startswith("3.")
        assert spec["info"]["title"] == "OpenBlock User Service"

    def test_paths_include_documented_routes(self, client):
        spec = json.loads(client.get("/openapi.json").get_data(as_text=True))
        paths = spec["paths"]
        assert "/api/users" in paths
        assert "/api/auth/login" in paths
        assert "/api/auth/refresh" in paths

    def test_schemas_registered(self, client):
        spec = json.loads(client.get("/openapi.json").get_data(as_text=True))
        schemas = spec["components"]["schemas"]
        assert "UserCreateSchema" in schemas
        assert "TokenPairSchema" in schemas
        assert "ErrorSchema" in schemas

    def test_swagger_ui_served(self, client):
        r = client.get("/docs")
        assert r.status_code == 200
        body = r.get_data(as_text=True)
        assert "swagger-ui" in body
        assert "/openapi.json" in body
