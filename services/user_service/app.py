"""
User Service - Flask application for user management
"""

import os
import hashlib
import secrets
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from ..common import ServiceConfig, init_db_manager, get_logger
from .models import User, UserProfile

logger = get_logger(__name__)


def create_app(config=None):
    app = Flask(__name__)

    if config is None:
        config = ServiceConfig.for_service("user")

    app.config["SERVICE_CONFIG"] = config

    if os.getenv("USE_POSTGRES", "false").lower() == "true":
        init_db_manager(config)

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "healthy", "service": "user"})

    @app.route("/api/users", methods=["POST"])
    def create_user():
        data = request.get_json()

        username = data.get("username")
        email = data.get("email")
        password = data.get("password")

        if not all([username, email, password]):
            return jsonify({"error": "Missing required fields"}), 400

        password_hash = hashlib.sha256(password.encode()).hexdigest()

        user = User(username=username, email=email, password_hash=password_hash)

        return jsonify(user.to_dict()), 201

    @app.route("/api/users/<user_id>", methods=["GET"])
    def get_user(user_id):
        return jsonify(
            {
                "id": user_id,
                "username": "user_" + user_id[:8],
                "email": f"user{user_id[:4]}@example.com",
                "is_premium": False,
                "created_at": datetime.utcnow().isoformat(),
            }
        )

    @app.route("/api/users/<user_id>", methods=["PUT"])
    def update_user(user_id):
        data = request.get_json()

        return jsonify({"id": user_id, "updated": True, "data": data})

    @app.route("/api/users/<user_id>/profile", methods=["GET"])
    def get_profile(user_id):
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
        data = request.get_json()

        return jsonify({"user_id": user_id, "updated": True, "profile": data})

    @app.route("/api/auth/login", methods=["POST"])
    def login():
        data = request.get_json()

        username = data.get("username")
        password = data.get("password")

        if not username or not password:
            return jsonify({"error": "Missing credentials"}), 401

        token = secrets.token_urlsafe(32)

        return jsonify(
            {"token": token, "user": {"id": "user_123", "username": username}}
        )

    @app.route("/api/auth/logout", methods=["POST"])
    def logout():
        return jsonify({"logged_out": True})

    @app.route("/api/auth/refresh", methods=["POST"])
    def refresh_token():
        data = request.get_json()
        refresh_token = data.get("refresh_token")

        if not refresh_token:
            return jsonify({"error": "Missing refresh token"}), 400

        new_token = secrets.token_urlsafe(32)

        return jsonify({"token": new_token})

    return app


if __name__ == "__main__":
    config = ServiceConfig.for_service("user")
    app = create_app(config)
    app.run(host=config.host, port=config.port, debug=config.debug)
