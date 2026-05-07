"""
metrics.py - Prometheus metrics collection
"""

import time
import random
from collections import defaultdict
from datetime import datetime, timedelta
from flask import Flask, jsonify, Response


class MetricsCollector:
    """In-memory Prometheus-compatible metrics collector"""

    def __init__(self):
        self._counters = defaultdict(lambda: defaultdict(int))
        self._gauges = defaultdict(dict)
        self._histograms = defaultdict(lambda: defaultdict(list))
        self._timers = {}

    def increment(self, name: str, labels: dict = None, value: int = 1):
        """Increment a counter metric"""
        key = self._make_key(name, labels)
        self._counters[name][key] += value

    def decrement(self, name: str, labels: dict = None, value: int = 1):
        """Decrement a counter metric"""
        key = self._make_key(name, labels)
        self._counters[name][key] -= value

    def set_gauge(self, name: str, value: float, labels: dict = None):
        """Set a gauge metric value"""
        key = self._make_key(name, labels)
        self._gauges[name][key] = value

    def observe(self, name: str, value: float, labels: dict = None):
        """Observe a histogram value"""
        key = self._make_key(name, labels)
        self._histograms[name][key].append(value)

    def start_timer(self, name: str):
        """Start a timer"""
        self._timers[name] = time.time()

    def stop_timer(self, name: str):
        """Stop a timer and observe the duration"""
        if name in self._timers:
            duration = time.time() - self._timers[name]
            self.observe(name + "_duration", duration)
            del self._timers[name]

    def _make_key(self, name: str, labels: dict = None) -> str:
        """Create a unique key for metric with labels"""
        if not labels:
            return "_global"

        label_str = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
        return f"{{{label_str}}}"

    def get_metrics(self) -> str:
        """Get all metrics in Prometheus format"""
        lines = []

        for name, data in self._counters.items():
            for labels, value in data.items():
                if labels == "_global":
                    lines.append(f"{name} {value}")
                else:
                    lines.append(f"{name}{labels} {value}")

        for name, data in self._gauges.items():
            for labels, value in data.items():
                if labels == "_global":
                    lines.append(f"{name} {value}")
                else:
                    lines.append(f"{name}{labels} {value}")

        for name, data in self._histograms.items():
            for labels, values in data.items():
                if values:
                    avg = sum(values) / len(values)
                    if labels == "_global":
                        lines.append(f"{name}_sum {sum(values)}")
                        lines.append(f"{name}_count {len(values)}")
                    else:
                        lines.append(f"{name}_sum{labels} {sum(values)}")
                        lines.append(f"{name}_count{labels} {len(values)}")

        return "\n".join(lines) + "\n"

    def get_json(self) -> dict:
        """Get all metrics as JSON"""
        return {
            "counters": dict(self._counters),
            "gauges": {k: dict(v) for k, v in self._gauges.items()},
            "histograms": {
                k: {kk: len(vv) for kk, vv in v.items()}
                for k, v in self._histograms.items()
            },
            "timestamp": datetime.utcnow().isoformat(),
        }

    def reset(self):
        """Reset all metrics"""
        self._counters.clear()
        self._gauges.clear()
        self._histograms.clear()
        self._timers.clear()


_metrics_collector = None


def get_metrics_collector() -> MetricsCollector:
    """Get the global metrics collector instance"""
    global _metrics_collector
    if _metrics_collector is None:
        _metrics_collector = MetricsCollector()
    return _metrics_collector


def create_metrics_app():
    """Create Flask app for metrics endpoint"""
    app = Flask(__name__)
    collector = get_metrics_collector()

    @app.route("/metrics", methods=["GET"])
    def metrics():
        """Prometheus metrics endpoint"""
        return Response(collector.get_metrics(), mimetype="text/plain")

    @app.route("/metrics/json", methods=["GET"])
    def metrics_json():
        """JSON metrics endpoint"""
        return jsonify(collector.get_json())

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "healthy", "service": "monitoring"})

    return app


def record_request(method: str, path: str, status: int, duration: float):
    """Record HTTP request metrics"""
    collector = get_metrics_collector()

    collector.increment(
        "http_requests_total", {"method": method, "path": path, "status": str(status)}
    )
    collector.observe(
        "http_request_duration_seconds", duration, {"method": method, "path": path}
    )

    if status >= 500:
        collector.increment("http_errors_total", {"status": str(status), "path": path})


def record_game_event(event_type: str, user_id: str = None):
    """Record game event metrics"""
    collector = get_metrics_collector()

    labels = {"event_type": event_type}
    if user_id:
        labels["user_id"] = user_id[:8]

    collector.increment("game_events_total", labels)


def record_revenue(amount: float, currency: str = "USD", product: str = None):
    """Record revenue metrics"""
    collector = get_metrics_collector()

    labels = {"currency": currency}
    if product:
        labels["product"] = product

    collector.increment("revenue_total", labels, int(amount * 100))
    collector.increment("purchases_total", labels)


def record_active_users(count: int):
    """Record active users gauge"""
    collector = get_metrics_collector()
    collector.set_gauge("active_users", count)


def record_queue_size(name: str, size: int):
    """Record queue size gauge"""
    collector = get_metrics_collector()
    collector.set_gauge(f"queue_{name}_size", size)
