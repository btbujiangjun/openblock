"""Tests for services.common.tracing.

OTel is intentionally a no-op when no exporter is configured (default in
unit tests). We assert:
  * init_tracing returns True when OTel libs are available
  * get_tracer always returns *something* with start_as_current_span
  * OTEL_DISABLED=1 short-circuits to False
"""

from __future__ import annotations

import pytest
from flask import Flask

from services.common.tracing import get_tracer, init_tracing


@pytest.fixture
def app():
    return Flask(__name__)


class TestInitTracing:
    def test_default_init_succeeds(self, app):
        ok = init_tracing(app, service_name="test")
        # OTel libs are in services/requirements.txt; CI install confirms.
        assert ok is True

    def test_disabled_short_circuits(self, app, monkeypatch):
        monkeypatch.setenv("OTEL_DISABLED", "1")
        assert init_tracing(app, service_name="test") is False


class TestTracer:
    def test_tracer_returns_span_context_manager(self):
        tracer = get_tracer("test")
        with tracer.start_as_current_span("op") as span:
            span.set_attribute("foo", "bar")  # must not raise
