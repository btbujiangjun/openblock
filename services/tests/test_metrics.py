"""Tests for services.common.metrics.

Covers:
  * init_metrics returns a metrics object and registers /metrics endpoint
  * /metrics serves Prometheus text-format on a real Flask app
  * PROMETHEUS_DISABLED=1 returns None and adds no route
"""

from __future__ import annotations

import pytest
from flask import Flask

from services.common.metrics import init_metrics


@pytest.fixture
def app():
    return Flask(__name__)


class TestInitMetrics:
    def test_returns_metrics_object(self, app):
        m = init_metrics(app, service_name="test")
        assert m is not None

    def test_metrics_endpoint_serves_prometheus(self, app):
        init_metrics(app, service_name="test")
        client = app.test_client()
        r = client.get("/metrics")
        assert r.status_code == 200
        body = r.get_data(as_text=True)
        # info gauge is always present
        assert "openblock_service_info" in body
        # Prometheus exposition format starts with `# HELP`
        assert body.startswith("# HELP") or "# TYPE" in body

    def test_disabled_returns_none(self, app, monkeypatch):
        monkeypatch.setenv("PROMETHEUS_DISABLED", "1")
        m = init_metrics(app, service_name="test")
        assert m is None
        # /metrics should 404 since we never registered it
        client = app.test_client()
        assert client.get("/metrics").status_code == 404
