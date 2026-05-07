"""
Game Service - Flask application for game sessions and leaderboards
"""

import os
import json
from datetime import datetime
from flask import Flask, request, jsonify
from ..common import ServiceConfig, init_redis_manager, get_logger
from ..common.metrics import init_metrics
from ..common.tracing import init_tracing
from .models import GameSession

logger = get_logger(__name__)


def create_app(config=None):
    app = Flask(__name__)

    if config is None:
        config = ServiceConfig.for_service("game")

    app.config["SERVICE_CONFIG"] = config

    # v1.15: standard observability hooks. Both no-op without env config.
    init_metrics(app, service_name="game")
    init_tracing(app, service_name="game")

    redis_manager = None
    if os.getenv("USE_REDIS", "false").lower() == "true":
        redis_manager = init_redis_manager(config)

    def get_leaderboard_key(mode: str, period: str) -> str:
        return f"leaderboard:{mode}:{period}"

    def update_leaderboard(
        user_id: str, score: int, mode: str = "global", period: str = "all_time"
    ):
        if redis_manager:
            key = get_leaderboard_key(mode, period)
            redis_manager.zadd(key, {user_id: score})

    def get_leaderboard(
        mode: str = "global", period: str = "all_time", limit: int = 100
    ):
        if redis_manager:
            key = get_leaderboard_key(mode, period)
            return redis_manager.zrevrange(key, 0, limit - 1, withscores=True)
        return []

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "healthy", "service": "game"})

    @app.route("/api/games", methods=["POST"])
    def start_game():
        data = request.get_json()

        user_id = data.get("user_id")
        mode = data.get("mode", "endless")

        session_id = f"session_{datetime.utcnow().timestamp()}"

        if redis_manager:
            session_cache_key = f"session:{session_id}"
            session_data = {
                "user_id": user_id,
                "mode": mode,
                "started_at": datetime.utcnow().isoformat(),
                "score": 0,
                "clears": 0,
            }
            redis_manager.set_json(session_cache_key, session_data, expire=3600)

        return jsonify(
            {
                "session_id": session_id,
                "started_at": datetime.utcnow().isoformat(),
                "mode": mode,
            }
        ), 201

    @app.route("/api/games/<session_id>", methods=["PUT"])
    def update_game(session_id):
        data = request.get_json()

        score = data.get("score", 0)
        clears = data.get("clears", 0)

        if redis_manager:
            session_cache_key = f"session:{session_id}"
            session_data = redis_manager.get_json(session_cache_key)
            if session_data:
                session_data["score"] = score
                session_data["clears"] = clears
                session_data["updated_at"] = datetime.utcnow().isoformat()
                redis_manager.set_json(session_cache_key, session_data, expire=3600)

        return jsonify({"session_id": session_id, "score": score, "clears": clears})

    @app.route("/api/games/<session_id>/end", methods=["POST"])
    def end_game(session_id):
        data = request.get_json()

        user_id = data.get("user_id")
        score = data.get("score", 0)
        clears = data.get("clears", 0)
        mode = data.get("mode", "endless")

        session_data = None
        if redis_manager:
            session_cache_key = f"session:{session_id}"
            session_data = redis_manager.get_json(session_cache_key)
            if session_data:
                redis_manager.delete(session_cache_key)

        if redis_manager and user_id:
            update_leaderboard(user_id, score, mode, "all_time")
            update_leaderboard(user_id, score, mode, "weekly")

        return jsonify(
            {
                "session_id": session_id,
                "ended_at": datetime.utcnow().isoformat(),
                "score": score,
                "clears": clears,
            }
        )

    @app.route("/api/leaderboards", methods=["GET"])
    def get_global_leaderboard():
        mode = request.args.get("mode", "global")
        period = request.args.get("period", "all_time")
        limit = int(request.args.get("limit", 100))

        leaderboard = get_leaderboard(mode, period, limit)

        results = []
        for i, (user_id, score) in enumerate(leaderboard):
            results.append({"rank": i + 1, "user_id": user_id, "score": int(score)})

        return jsonify({"leaderboard": results, "mode": mode, "period": period})

    @app.route("/api/leaderboards/<user_id>/rank", methods=["GET"])
    def get_user_rank(user_id):
        mode = request.args.get("mode", "global")
        period = request.args.get("period", "all_time")

        if redis_manager:
            key = get_leaderboard_key(mode, period)
            rank = redis_manager.zrank(key, user_id)
            if rank is not None:
                return jsonify(
                    {
                        "user_id": user_id,
                        "rank": rank + 1,
                        "mode": mode,
                        "period": period,
                    }
                )

        return jsonify(
            {"user_id": user_id, "rank": None, "mode": mode, "period": period}
        )

    @app.route("/api/achievements/<user_id>", methods=["GET"])
    def get_achievements(user_id):
        achievements = [
            {
                "id": "first_game",
                "name": "First Game",
                "completed": True,
                "progress": 1,
            },
            {
                "id": "score_1000",
                "name": "Score 1000",
                "completed": False,
                "progress": 750,
            },
            {
                "id": "clear_50",
                "name": "Clear 50 Lines",
                "completed": False,
                "progress": 35,
            },
        ]

        return jsonify({"user_id": user_id, "achievements": achievements})

    @app.route("/api/levels/<user_id>", methods=["GET"])
    def get_level_progress(user_id):
        levels = [
            {"level_id": "L01", "stars": 3, "completed": True},
            {"level_id": "L02", "stars": 2, "completed": True},
            {"level_id": "L03", "stars": 0, "completed": False},
        ]

        return jsonify(
            {
                "user_id": user_id,
                "levels": levels,
                "total_stars": 5,
                "completed_levels": 2,
            }
        )

    return app


if __name__ == "__main__":
    config = ServiceConfig.for_service("game")
    app = create_app(config)
    app.run(host=config.host, port=config.port, debug=config.debug)
