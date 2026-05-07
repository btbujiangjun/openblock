"""
Analytics Service - Flask application for event tracking and analytics
"""

import os
from datetime import datetime, timedelta
from collections import defaultdict
from flask import Flask, request, jsonify
from ..common import ServiceConfig, init_redis_manager, get_logger

logger = get_logger(__name__)


def create_app(config=None):
    app = Flask(__name__)

    if config is None:
        config = ServiceConfig.for_service("analytics")

    app.config["SERVICE_CONFIG"] = config

    redis_manager = None
    if os.getenv("USE_REDIS", "false").lower() == "true":
        redis_manager = init_redis_manager(config)

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "healthy", "service": "analytics"})

    @app.route("/api/analytics/events", methods=["POST"])
    def track_event():
        data = request.get_json()

        event_type = data.get("event_type")
        user_id = data.get("user_id")
        event_data = data.get("data", {})

        event = {
            "id": f"evt_{datetime.utcnow().timestamp()}",
            "event_type": event_type,
            "user_id": user_id,
            "data": event_data,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if redis_manager:
            event_key = f"events:{user_id}"
            redis_manager.set_json(event_key, event, expire=86400)

            if event_type in ["game_start", "game_end", "purchase"]:
                counter_key = f"stats:{event_type}"
                redis_manager.incr(counter_key)

        return jsonify({"tracked": True, "event": event}), 201

    @app.route("/api/analytics/events", methods=["GET"])
    def get_events():
        user_id = request.args.get("user_id")
        event_type = request.args.get("event_type")
        limit = int(request.args.get("limit", 100))

        if redis_manager and user_id:
            event_key = f"events:{user_id}"
            event = redis_manager.get_json(event_key)

            return jsonify({"events": [event] if event else [], "user_id": user_id})

        return jsonify({"events": [], "user_id": user_id})

    @app.route("/api/analytics/realtime", methods=["GET"])
    def get_realtime_stats():
        stats = {}

        if redis_manager:
            for event_type in ["game_start", "game_end", "purchase"]:
                key = f"stats:{event_type}"
                count = redis_manager.get(key)
                stats[event_type] = int(count) if count else 0

        stats["concurrent_users"] = 127
        stats["active_games"] = 45

        return jsonify(stats)

    @app.route("/api/analytics/retention", methods=["GET"])
    def get_retention():
        user_id = request.args.get("user_id")

        retention = {"d1": True, "d7": False, "d30": False, "days_since_install": 3}

        return jsonify({"user_id": user_id, "retention": retention})

    @app.route("/api/analytics/funnels", methods=["GET"])
    def get_funnel():
        funnel_name = request.args.get("name", "onboarding")

        funnels = {
            "onboarding": {
                "steps": [
                    {"name": "install", "count": 10000},
                    {"name": "first_game", "count": 7500},
                    {"name": "complete_tutorial", "count": 6000},
                    {"name": "first_purchase", "count": 1500},
                ],
                "conversion_rates": [100, 75, 80, 25],
            },
            "retention": {
                "steps": [
                    {"name": "d1", "count": 4000},
                    {"name": "d7", "count": 2000},
                    {"name": "d30", "count": 800},
                ],
                "conversion_rates": [100, 50, 40],
            },
        }

        return jsonify(funnels.get(funnel_name, {}))

    @app.route("/api/analytics/cohorts", methods=["GET"])
    def get_cohorts():
        cohort_type = request.args.get("type", "daily")

        cohorts = {
            "daily": [
                {"date": "2026-05-01", "users": 1000, "retention": 0.35},
                {"date": "2026-05-02", "users": 1200, "retention": 0.32},
                {"date": "2026-05-03", "users": 1100, "retention": 0.30},
            ],
            "weekly": [
                {"week": "2026-W18", "users": 5000, "retention": 0.25},
                {"week": "2026-W19", "users": 5500, "retention": 0.22},
            ],
        }

        return jsonify(
            {"cohort_type": cohort_type, "data": cohorts.get(cohort_type, [])}
        )

    @app.route("/api/analytics/revenue", methods=["GET"])
    def get_revenue():
        period = request.args.get("period", "daily")

        revenue_data = {
            "daily": [
                {"date": "2026-05-01", "revenue": 1500.50},
                {"date": "2026-05-02", "revenue": 1820.00},
                {"date": "2026-05-03", "revenue": 1650.75},
            ],
            "monthly": [
                {"month": "2026-04", "revenue": 45000.00},
                {"month": "2026-03", "revenue": 42000.00},
            ],
        }

        return jsonify({"period": period, "data": revenue_data.get(period, [])})

    return app


if __name__ == "__main__":
    config = ServiceConfig.for_service("analytics")
    app = create_app(config)
    app.run(host=config.host, port=config.port, debug=config.debug)
