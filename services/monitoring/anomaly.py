"""
anomaly.py - Anomaly detection system
"""

import time
import math
from collections import deque
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any


class DataPoint:
    """Simple data point with timestamp"""

    def __init__(self, value: float, timestamp: float = None):
        self.value = value
        self.timestamp = timestamp or time.time()


class AnomalyDetector:
    """Statistical anomaly detection with moving averages and standard deviation"""

    def __init__(self, window_size: int = 100, threshold: float = 3.0):
        self.window_size = window_size
        self.threshold = threshold
        self._data = deque(maxlen=window_size)
        self._alerts = []

    def add(self, value: float) -> Optional[Dict[str, Any]]:
        """Add a data point and check for anomalies"""
        point = DataPoint(value)
        self._data.append(point)

        if len(self._data) < 10:
            return None

        is_anomaly = self._check_anomaly(value)

        if is_anomaly:
            alert = {
                "type": "anomaly",
                "value": value,
                "expected_range": self._get_expected_range(),
                "timestamp": datetime.utcnow().isoformat(),
                "severity": self._get_severity(value),
            }
            self._alerts.append(alert)

            if len(self._alerts) > 100:
                self._alerts = self._alerts[-100:]

            return alert

        return None

    def _check_anomaly(self, value: float) -> bool:
        """Check if value is anomalous using z-score"""
        values = [p.value for p in self._data]

        if len(values) < 2:
            return False

        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        std = math.sqrt(variance)

        if std == 0:
            return False

        z_score = abs(value - mean) / std
        return z_score > self.threshold

    def _get_expected_range(self) -> tuple:
        """Get expected value range"""
        values = [p.value for p in self._data]

        if len(values) < 2:
            return (0, 0)

        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        std = math.sqrt(variance)

        return (mean - self.threshold * std, mean + self.threshold * std)

    def _get_severity(self, value: float) -> str:
        """Get alert severity based on deviation"""
        values = [p.value for p in self._data]
        mean = sum(values) / len(values)

        if not values:
            return "low"

        percent_diff = abs(value - mean) / mean * 100 if mean > 0 else 0

        if percent_diff > 200:
            return "critical"
        elif percent_diff > 100:
            return "high"
        elif percent_diff > 50:
            return "medium"
        return "low"

    def get_stats(self) -> Dict[str, float]:
        """Get statistics about the data"""
        if not self._data:
            return {"count": 0, "mean": 0, "std": 0, "min": 0, "max": 0}

        values = [p.value for p in self._data]
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        std = math.sqrt(variance)

        return {
            "count": len(values),
            "mean": mean,
            "std": std,
            "min": min(values),
            "max": max(values),
            "threshold": self.threshold,
        }

    def get_alerts(self, since: float = None) -> List[Dict]:
        """Get alerts since timestamp"""
        if since is None:
            return list(self._alerts)

        return [
            a
            for a in self._alerts
            if datetime.fromisoformat(a["timestamp"]).timestamp() > since
        ]

    def clear_alerts(self):
        """Clear all alerts"""
        self._alerts = []


class TrendDetector:
    """Detect trends in data"""

    def __init__(self, min_points: int = 10):
        self.min_points = min_points
        self._points = deque(maxlen=100)

    def add(self, value: float) -> Optional[str]:
        """Add point and detect trend"""
        self._points.append(value)

        if len(self._points) < self.min_points:
            return None

        return self._detect_trend()

    def _detect_trend(self) -> str:
        """Detect trend using linear regression"""
        n = len(self._points)
        x = list(range(n))
        y = list(self._points)

        x_mean = sum(x) / n
        y_mean = sum(y) / n

        numerator = sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))

        if denominator == 0:
            return "stable"

        slope = numerator / denominator

        if slope > 0.1:
            return "increasing"
        elif slope < -0.1:
            return "decreasing"
        return "stable"


class AlertManager:
    """Manage alerting rules and notifications"""

    def __init__(self):
        self._rules = []
        self._notifications = []
        self._detectors = {}

    def add_rule(
        self,
        name: str,
        metric: str,
        condition: str,
        threshold: float,
        severity: str = "medium",
    ):
        """Add an alert rule"""
        rule = {
            "name": name,
            "metric": metric,
            "condition": condition,
            "threshold": threshold,
            "severity": severity,
            "enabled": True,
            "triggered_at": None,
        }
        self._rules.append(rule)

        if metric not in self._detectors:
            self._detectors[metric] = AnomalyDetector()

        return rule

    def check_rule(self, rule: str, value: float) -> Optional[Dict]:
        """Check if rule is triggered"""
        for r in self._rules:
            if r["name"] == rule:
                triggered = self._evaluate_condition(
                    r["condition"], value, r["threshold"]
                )

                if triggered and not r["triggered_at"]:
                    r["triggered_at"] = datetime.utcnow().isoformat()

                    notification = {
                        "rule": rule,
                        "value": value,
                        "threshold": r["threshold"],
                        "severity": r["severity"],
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    self._notifications.append(notification)

                    return notification

                if not triggered:
                    r["triggered_at"] = None

        return None

    def _evaluate_condition(
        self, condition: str, value: float, threshold: float
    ) -> bool:
        """Evaluate condition"""
        if condition == "greater_than":
            return value > threshold
        elif condition == "less_than":
            return value < threshold
        elif condition == "equals":
            return value == threshold
        return False

    def get_rules(self) -> List[Dict]:
        """Get all rules"""
        return list(self._rules)

    def get_notifications(self, limit: int = 50) -> List[Dict]:
        """Get recent notifications"""
        return self._notifications[-limit:]

    def acknowledge(self, notification_index: int):
        """Acknowledge a notification"""
        if 0 <= notification_index < len(self._notifications):
            self._notifications[notification_index]["acknowledged"] = True

    def clear_notifications(self):
        """Clear all notifications"""
        self._notifications = []


def create_default_detectors() -> Dict[str, AnomalyDetector]:
    """Create default anomaly detectors for common metrics"""
    return {
        "response_time": AnomalyDetector(window_size=100, threshold=3.0),
        "error_rate": AnomalyDetector(window_size=50, threshold=2.5),
        "active_users": AnomalyDetector(window_size=30, threshold=2.0),
        "revenue": AnomalyDetector(window_size=100, threshold=3.0),
        "queue_size": AnomalyDetector(window_size=50, threshold=2.0),
    }
