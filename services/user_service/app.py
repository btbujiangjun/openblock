"""
User Service — Flask application for user management.

v1.14:
  - Argon2id password hashing, JWT (access + refresh, rotated) auth,
    pluggable repository.

v1.15:
  - Auto-instrument Prometheus metrics + OpenTelemetry tracing.
  - Auto-publish OpenAPI 3.0 spec at `/openapi.json` and Swagger UI
    at `/docs`.
  - Production repository now defaults to SQLAlchemy (`SqlUserRepository`)
    when `USE_POSTGRES=true`; the in-memory repo remains the test default.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from typing import Optional, Protocol

from flask import Flask, jsonify, request

from ..common import ServiceConfig, get_logger
from ..common.metrics import init_metrics
from ..common.tracing import init_tracing
from ..security.jwt_tokens import JWTConfigError, JWTError, JWTManager
from ..security.password import PasswordHasher, PasswordPolicyError
from .models import User
from .openapi import register_openapi

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Repository interface (dev: in-memory; prod: Postgres / SQLAlchemy)
# ---------------------------------------------------------------------------
class UserRepository(Protocol):
    def create(self, *, username: str, email: str, password_hash: str) -> dict: ...
    def get_by_username(self, username: str) -> Optional[dict]: ...
    def get_by_id(self, user_id: str) -> Optional[dict]: ...


@dataclass
class _MemoryRepo:
    """Process-local user store. NOT for production."""

    by_username: dict = field(default_factory=dict)
    by_id: dict = field(default_factory=dict)

    def create(self, *, username: str, email: str, password_hash: str) -> dict:
        if username in self.by_username:
            raise ValueError("username already exists")
        user = User(
            id=str(uuid.uuid4()),
            username=username,
            email=email,
            password_hash=password_hash,
        )
        record = user.to_dict()
        self.by_username[username] = record
        self.by_id[record["id"]] = record
        return record

    def get_by_username(self, username: str) -> Optional[dict]:
        return self.by_username.get(username)

    def get_by_id(self, user_id: str) -> Optional[dict]:
        return self.by_id.get(user_id)


def _build_default_repo() -> "UserRepository":
    """Pick a repo implementation based on env.

    USE_POSTGRES=true (or any explicit DATABASE_URL) → SqlUserRepository.
    Otherwise the in-memory repo (default for tests / first-run dev).
    """
    use_pg = os.getenv("USE_POSTGRES", "false").lower() in ("1", "true", "yes", "on")
    if use_pg or os.getenv("DATABASE_URL"):
        from ..common.orm import build_engine
        from .sql_repository import SqlUserRepository

        engine = build_engine()
        repo = SqlUserRepository(engine)
        # In production, schema is owned by Alembic. We still call
        # `create_schema()` here so first-boot dev / tests don't have to
        # run alembic before they can hit /api/users.
        if os.getenv("AUTO_CREATE_SCHEMA", "1") in ("1", "true"):
            repo.create_schema()
        return repo
    return _MemoryRepo()


def create_app(
    config=None,
    *,
    user_repo: Optional[UserRepository] = None,
    password_hasher: Optional[PasswordHasher] = None,
    jwt_manager: Optional[JWTManager] = None,
):
    app = Flask(__name__)

    if config is None:
        config = ServiceConfig.for_service("user")
    app.config["SERVICE_CONFIG"] = config

    repo: UserRepository = user_repo or _build_default_repo()
    hasher = password_hasher or PasswordHasher()
    try:
        jwt = jwt_manager or JWTManager()
    except JWTConfigError as exc:
        # Surface configuration errors loudly at boot so a misconfigured
        # deployment fails its readiness check rather than serving traffic.
        logger.error("user_service refusing to boot: %s", exc)
        raise

    # v1.15: auto-instrument metrics + tracing + OpenAPI. All three are
    # zero-config in dev (no exporter / no DB) and pick up env-driven
    # production wiring transparently.
    init_metrics(app, service_name="user")
    init_tracing(app, service_name="user")
    register_openapi(app)

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "healthy", "service": "user"})

    @app.route("/livez", methods=["GET"])
    def livez():
        return jsonify({"alive": True})

    @app.route("/readyz", methods=["GET"])
    def readyz():
        return jsonify({"ready": True, "auth": "jwt", "hasher": "argon2id"})

    # --------------------------------------------------------------
    # User CRUD
    # --------------------------------------------------------------
    @app.route("/api/users", methods=["POST"])
    def create_user():
        """Create a new user account.
        ---
        post:
          summary: Create user
          tags: [users]
          requestBody:
            required: true
            content:
              application/json:
                schema: UserCreateSchema
          responses:
            "201":
              description: Created
              content:
                application/json:
                  schema: UserResponseSchema
            "400":
              description: Validation failure
              content:
                application/json:
                  schema: ErrorSchema
            "409":
              description: Username already exists
              content:
                application/json:
                  schema: ErrorSchema
        """
        data = request.get_json(silent=True) or {}
        username = data.get("username")
        email = data.get("email")
        password = data.get("password")
        if not all([username, email, password]):
            return jsonify({"error": "Missing required fields"}), 400
        try:
            password_hash = hasher.hash(password)
        except PasswordPolicyError as exc:
            return jsonify({"error": str(exc), "code": "WEAK_PASSWORD"}), 400
        try:
            record = repo.create(username=username, email=email, password_hash=password_hash)
        except ValueError as exc:
            return jsonify({"error": str(exc), "code": "USER_EXISTS"}), 409
        # Strip password hash before sending the record back to the caller.
        safe = {k: v for k, v in record.items() if k != "password_hash"}
        return jsonify(safe), 201

    @app.route("/api/users/<user_id>", methods=["GET"])
    def get_user(user_id):
        record = repo.get_by_id(user_id)
        if not record:
            return jsonify({"error": "Not found"}), 404
        safe = {k: v for k, v in record.items() if k != "password_hash"}
        return jsonify(safe)

    @app.route("/api/users/<user_id>", methods=["PUT"])
    def update_user(user_id):
        # Update path is intentionally minimal in the in-memory repo;
        # production repository will manage immutability rules + audit log.
        if not repo.get_by_id(user_id):
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        return jsonify({"id": user_id, "updated": True, "data": data})

    @app.route("/api/users/<user_id>/profile", methods=["GET"])
    def get_profile(user_id):
        if not repo.get_by_id(user_id):
            return jsonify({"error": "Not found"}), 404
        return jsonify(
            {
                "user_id": user_id,
                "display_name": "Player",
                "avatar_url": None,
                "bio": "",
                "level": 1,
                "total_score": 0,
            }
        )

    @app.route("/api/users/<user_id>/profile", methods=["PUT"])
    def update_profile(user_id):
        if not repo.get_by_id(user_id):
            return jsonify({"error": "Not found"}), 404
        data = request.get_json(silent=True) or {}
        return jsonify({"user_id": user_id, "updated": True, "profile": data})

    # --------------------------------------------------------------
    # Auth
    # --------------------------------------------------------------
    @app.route("/api/auth/login", methods=["POST"])
    def login():
        """Issue a JWT pair after verifying credentials.
        ---
        post:
          summary: Login
          tags: [auth]
          requestBody:
            required: true
            content:
              application/json:
                schema: LoginSchema
          responses:
            "200":
              description: OK
              content:
                application/json:
                  schema: TokenPairSchema
            "401":
              description: Invalid credentials
              content:
                application/json:
                  schema: ErrorSchema
        """
        data = request.get_json(silent=True) or {}
        username = data.get("username")
        password = data.get("password")
        if not username or not password:
            return jsonify({"error": "Missing credentials"}), 400

        record = repo.get_by_username(username)
        if not record or not hasher.verify(password, record.get("password_hash", "")):
            # Use a single generic message for both "no such user" and
            # "wrong password" to avoid user enumeration via response diff.
            return jsonify({"error": "Invalid credentials"}), 401

        pair = jwt.issue(record["id"], extra_claims={"username": record["username"]})
        return jsonify({"user": {"id": record["id"], "username": record["username"]}, **pair.to_dict()})

    @app.route("/api/auth/refresh", methods=["POST"])
    def refresh_token():
        """Rotate the refresh token, issuing a new access + refresh pair.
        ---
        post:
          summary: Refresh tokens (rotation)
          tags: [auth]
          requestBody:
            required: true
            content:
              application/json:
                schema: RefreshSchema
          responses:
            "200":
              description: OK
              content:
                application/json:
                  schema: TokenPairSchema
            "401":
              description: Invalid or revoked refresh token
              content:
                application/json:
                  schema: ErrorSchema
        """
        data = request.get_json(silent=True) or {}
        refresh = data.get("refresh_token")
        if not refresh:
            return jsonify({"error": "Missing refresh token"}), 400
        try:
            pair = jwt.refresh(refresh)
        except JWTError as exc:
            return jsonify({"error": str(exc), "code": "INVALID_REFRESH"}), 401
        return jsonify(pair.to_dict())

    @app.route("/api/auth/logout", methods=["POST"])
    def logout():
        data = request.get_json(silent=True) or {}
        token = data.get("token")
        if token:
            jwt.revoke(token)
        return jsonify({"logged_out": True})

    @app.route("/api/auth/verify", methods=["POST"])
    def verify_token():
        """Used by the API gateway / other services to validate access tokens."""
        data = request.get_json(silent=True) or {}
        token = data.get("token") or _extract_bearer(request)
        if not token:
            return jsonify({"error": "Missing token"}), 400
        try:
            payload = jwt.verify(token, expected_type="access")
        except JWTError as exc:
            return jsonify({"error": str(exc), "code": "INVALID_TOKEN"}), 401
        return jsonify({"valid": True, "payload": payload})

    return app


def _extract_bearer(req) -> Optional[str]:
    auth = req.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None


if __name__ == "__main__":  # pragma: no cover
    cfg = ServiceConfig.for_service("user")
    app = create_app(cfg)
    app.run(host=cfg.host, port=cfg.port, debug=cfg.debug)
