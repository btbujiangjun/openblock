"""
alerting.py - Alert management and notification system
"""

import os
import json
import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Callable


class Alert:
    """Alert representation"""

    def __init__(
        self,
        id: str,
        title: str,
        message: str,
        severity: str = "info",
        source: str = None,
        metadata: dict = None,
    ):
        self.id = id
        self.title = title
        self.message = message
        self.severity = severity
        self.source = source
        self.metadata = metadata or {}
        self.timestamp = datetime.utcnow()
        self.acknowledged = False
        self.resolved = False
        self.resolved_at = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "message": self.message,
            "severity": self.severity,
            "source": self.source,
            "metadata": self.metadata,
            "timestamp": self.timestamp.isoformat(),
            "acknowledged": self.acknowledged,
            "resolved": self.resolved,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }


class AlertChannel:
    """Base class for alert channels"""

    def send(self, alert: Alert):
        raise NotImplementedError


class LogChannel(AlertChannel):
    """Log alerts to console/file"""

    def send(self, alert: Alert):
        prefix = {
            "critical": "🚨",
            "error": "❌",
            "warning": "⚠️",
            "info": "ℹ️",
            "debug": "🔍",
        }.get(alert.severity, "📢")

        print(f"{prefix} [{alert.severity.upper()}] {alert.title}: {alert.message}")


class WebhookChannel(AlertChannel):
    """Send alerts to webhook URL"""

    def __init__(self, url: str):
        self.url = url

    def send(self, alert: Alert):
        try:
            import urllib.request
            import urllib.parse

            data = json.dumps(alert.to_dict()).encode("utf-8")
            req = urllib.request.Request(
                self.url, data=data, headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:
            print(f"Failed to send webhook: {e}")


class AlertManager:
    """Complete alert management system"""

    def __init__(self):
        self._alerts = []
        self._channels = [LogChannel()]
        self._handlers = []
        self._alert_counts = {"critical": 0, "error": 0, "warning": 0, "info": 0}
        self._max_alerts = 1000

    def add_channel(self, channel: AlertChannel):
        """Add notification channel"""
        self._channels.append(channel)

    def add_handler(self, handler: Callable):
        """Add custom alert handler"""
        self._handlers.append(handler)

    def create_alert(
        self,
        title: str,
        message: str,
        severity: str = "info",
        source: str = None,
        metadata: dict = None,
    ) -> Alert:
        """Create and send an alert"""
        alert_id = f"alert_{int(time.time() * 1000)}_{len(self._alerts)}"

        alert = Alert(
            id=alert_id,
            title=title,
            message=message,
            severity=severity,
            source=source,
            metadata=metadata,
        )

        self._alerts.append(alert)

        if len(self._alerts) > self._max_alerts:
            self._alerts = self._alerts[-self._max_alerts :]

        self._alert_counts[severity] = self._alert_counts.get(severity, 0) + 1

        self._notify_channels(alert)
        self._run_handlers(alert)

        return alert

    def _notify_channels(self, alert: Alert):
        """Send alert to all channels"""
        for channel in self._channels:
            try:
                channel.send(alert)
            except Exception as e:
                print(f"Channel notification failed: {e}")

    def _run_handlers(self, alert: Alert):
        """Run custom handlers"""
        for handler in self._handlers:
            try:
                handler(alert)
            except Exception as e:
                print(f"Handler failed: {e}")

    def get_alerts(
        self,
        severity: str = None,
        acknowledged: bool = None,
        resolved: bool = None,
        since: datetime = None,
        limit: int = 100,
    ) -> List[Alert]:
        """Get filtered alerts"""
        result = list(self._alerts)

        if severity:
            result = [a for a in result if a.severity == severity]

        if acknowledged is not None:
            result = [a for a in result if a.acknowledged == acknowledged]

        if resolved is not None:
            result = [a for a in result if a.resolved == resolved]

        if since:
            result = [a for a in result if a.timestamp > since]

        return result[-limit:]

    def acknowledge_alert(self, alert_id: str):
        """Acknowledge an alert"""
        for alert in self._alerts:
            if alert.id == alert_id:
                alert.acknowledged = True
                break

    def resolve_alert(self, alert_id: str):
        """Resolve an alert"""
        for alert in self._alerts:
            if alert.id == alert_id:
                alert.resolved = True
                alert.resolved_at = datetime.utcnow()
                break

    def get_counts(self) -> dict:
        """Get alert counts by severity"""
        active = [a for a in self._alerts if not a.resolved]

        return {
            "total": len(self._alerts),
            "active": len(active),
            "critical": len([a for a in active if a.severity == "critical"]),
            "error": len([a for a in active if a.severity == "error"]),
            "warning": len([a for a in active if a.severity == "warning"]),
            "info": len([a for a in active if a.severity == "info"]),
        }

    def get_summary(self) -> dict:
        """Get alert summary"""
        return {
            "counts": self.get_counts(),
            "recent": [a.to_dict() for a in self._alerts[-10:]],
            "timestamp": datetime.utcnow().isoformat(),
        }


_alert_manager = None


def get_alert_manager() -> AlertManager:
    """Get global alert manager"""
    global _alert_manager
    if _alert_manager is None:
        _alert_manager = AlertManager()
    return _alert_manager


def create_alert(title: str, message: str, severity: str = "info", **kwargs):
    """Quick alert creation"""
    return get_alert_manager().create_alert(title, message, severity, **kwargs)


def alert_on_error(func):
    """Decorator to alert on function error"""

    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            create_alert(
                f"Error in {func.__name__}",
                str(e),
                severity="error",
                source=func.__module__,
            )
            raise

    return wrapper
