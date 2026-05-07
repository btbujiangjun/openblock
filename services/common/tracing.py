"""
tracing.py — OpenTelemetry distributed tracing.

v1.15 wires OTel into every Flask service. Defaults are zero-overhead:
unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, traces are produced but
dropped on the floor (NoOp exporter), so unit tests and local dev pay
nothing.

Production export targets supported out of the box:
  - OTLP/HTTP (Jaeger ≥1.35, Tempo, Honeycomb, Datadog OTel collector,
    AWS Distro for OpenTelemetry, etc.)
  - Configure via standard OTel envs:
        OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com
        OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=...
        OTEL_SERVICE_NAME=openblock-user
        OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.version=1.15.0

Auto-instrumentation:
  - Flask: every request becomes a span (with route, status, method).
  - requests: outbound HTTP calls become child spans (so user-svc →
    game-svc traces stitch across services with W3C tracecontext
    propagation).
  - SQLAlchemy: queries become spans labelled with the statement.

Manual spans are still available via `trace.get_tracer(__name__)`.
"""

from __future__ import annotations

import os
from typing import Optional

try:
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
        OTLPSpanExporter,
    )
    from opentelemetry.instrumentation.flask import FlaskInstrumentor
    from opentelemetry.instrumentation.requests import RequestsInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        BatchSpanProcessor,
        ConsoleSpanExporter,
    )

    _AVAILABLE = True
except Exception:  # pragma: no cover
    _AVAILABLE = False


_initialized = False


def init_tracing(
    app=None,
    *,
    service_name: str,
    version: str = "v1.15",
    sqlalchemy_engine=None,
) -> bool:
    """Initialize OTel and (optionally) instrument a Flask app.

    Returns True on success, False if OTel is unavailable / disabled.

    Idempotent: safe to call multiple times across services in the same
    process (e.g. tests instantiating multiple Flask apps).
    """
    global _initialized

    if not _AVAILABLE or os.getenv("OTEL_DISABLED", "0") == "1":
        return False

    if not _initialized:
        resource = Resource.create(
            {
                "service.name": os.getenv("OTEL_SERVICE_NAME", f"openblock-{service_name}"),
                "service.version": version,
                "deployment.environment": os.getenv("DEPLOYMENT_ENV", "dev"),
            }
        )
        provider = TracerProvider(resource=resource)

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        if endpoint:
            # Production: ship via OTLP.
            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint))
            )
        elif os.getenv("OTEL_CONSOLE", "0") == "1":
            # Dev: print to stdout when explicitly opted in.
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        # Else: traces are still produced (so context propagates) but
        # not exported. Zero overhead beyond span creation.

        trace.set_tracer_provider(provider)
        RequestsInstrumentor().instrument()
        _initialized = True

    if app is not None:
        FlaskInstrumentor().instrument_app(app)

    if sqlalchemy_engine is not None:
        try:
            from opentelemetry.instrumentation.sqlalchemy import (
                SQLAlchemyInstrumentor,
            )

            SQLAlchemyInstrumentor().instrument(engine=sqlalchemy_engine)
        except Exception:
            # Optional dependency; skip silently if missing.
            pass

    return True


def get_tracer(name: str):
    """Convenience accessor; returns a NoOp tracer if OTel is disabled."""
    if not _AVAILABLE:
        class _NoOpSpan:
            def __enter__(self):
                return self

            def __exit__(self, *a, **kw):
                return False

            def set_attribute(self, *a, **kw):
                pass

            def record_exception(self, *a, **kw):
                pass

        class _NoOpTracer:
            def start_as_current_span(self, *a, **kw):
                return _NoOpSpan()

        return _NoOpTracer()

    return trace.get_tracer(name)
