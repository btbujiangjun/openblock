"""
Monitoring Service - Flask application for metrics, alerts, and anomaly detection
"""

from flask import Flask, jsonify, request
from .metrics import (
    get_metrics_collector,
    record_request,
    record_game_event,
    record_revenue,
)
from .anomaly import (
    AnomalyDetector,
    AlertManager,
    get_alert_manager,
    create_default_detectors,
)
from .alerting import create_alert
from ..common.tracing import init_tracing


def create_app():
    app = Flask(__name__)

    # v1.15: monitoring already exposes its own /metrics (JSON) and
    # /metrics/prometheus, so we deliberately skip init_metrics here to
    # avoid the route collision; tracing is still useful for cross-service
    # span propagation when the monitoring service calls others.
    init_tracing(app, service_name="monitoring")

    detectors = create_default_detectors()
    alert_manager = get_alert_manager()

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "healthy", "service": "monitoring"})

    @app.route("/metrics", methods=["GET"])
    def metrics():
        collector = get_metrics_collector()
        return collector.get_json()

    @app.route("/metrics/prometheus", methods=["GET"])
    def prometheus_metrics():
        collector = get_metrics_collector()
        return collector.get_metrics()

    @app.route("/monitoring/errors", methods=["POST"])
    def track_error():
        data = request.get_json()

        severity = data.get("level", "error")
        create_alert(
            title=data.get("message", "Client Error"),
            message=data.get("stack", ""),
            severity=severity,
            source="frontend",
            metadata=data.get("metadata", {}),
        )

        return jsonify({"tracked": True})

    @app.route("/monitoring/events", methods=["POST"])
    def track_event():
        data = request.get_json()

        event_type = data.get("event_type")
        user_id = data.get("user_id")

        record_game_event(event_type, user_id)

        if event_type == "game_start":
            detector = detectors.get("active_users")
            if detector:
                detector.add(1)

        return jsonify({"tracked": True})

    @app.route("/monitoring/anomaly/<metric_name>", methods=["POST"])
    def check_anomaly(metric_name):
        data = request.get_json()
        value = data.get("value", 0)

        detector = detectors.get(metric_name)
        if detector:
            result = detector.add(value)
            if result:
                create_alert(
                    title=f"Anomaly detected in {metric_name}",
                    message=f"Value {value} is outside expected range",
                    severity=result["severity"],
                    source="anomaly_detection",
                    metadata=result,
                )
                return jsonify({"anomaly": True, "details": result})

        return jsonify({"anomaly": False})

    @app.route("/monitoring/anomaly/<metric_name>/stats", methods=["GET"])
    def get_anomaly_stats(metric_name):
        detector = detectors.get(metric_name)
        if detector:
            return jsonify(detector.get_stats())
        return jsonify({"error": "Metric not found"}), 404

    @app.route("/alerts", methods=["GET"])
    def get_alerts():
        severity = request.args.get("severity")
        resolved = request.args.get("resolved")
        limit = int(request.args.get("limit", 50))

        resolved_bool = None
        if resolved is not None:
            resolved_bool = resolved.lower() == "true"

        alerts = alert_manager.get_alerts(
            severity=severity, resolved=resolved_bool, limit=limit
        )

        return jsonify(
            {
                "alerts": [a.to_dict() for a in alerts],
                "counts": alert_manager.get_counts(),
            }
        )

    @app.route("/alerts/<alert_id>/acknowledge", methods=["POST"])
    def acknowledge_alert(alert_id):
        alert_manager.acknowledge_alert(alert_id)
        return jsonify({"acknowledged": True})

    @app.route("/alerts/<alert_id>/resolve", methods=["POST"])
    def resolve_alert(alert_id):
        alert_manager.resolve_alert(alert_id)
        return jsonify({"resolved": True})

    @app.route("/alerts/summary", methods=["GET"])
    def alerts_summary():
        return jsonify(alert_manager.get_summary())

    @app.route("/alerts", methods=["POST"])
    def create_manual_alert():
        data = request.get_json()

        alert = create_alert(
            title=data.get("title"),
            message=data.get("message"),
            severity=data.get("severity", "info"),
            source=data.get("source", "manual"),
        )

        return jsonify(alert.to_dict()), 201

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=8004, debug=True)
