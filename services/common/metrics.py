"""
metrics.py — Prometheus instrumentation helper.

v1.15 adds first-class metrics to every Flask service. The "four golden
signals" (Google SRE) are enforced by default:

  - **Traffic**:    `http_requests_total{method,endpoint,status}` (counter)
  - **Errors**:     same counter, status≥500 = error rate denominator
  - **Latency**:    `http_request_duration_seconds_*` (histogram, default
                    buckets cover 5ms..30s; P50 / P95 / P99 derivable)
  - **Saturation**: `http_requests_in_flight` (gauge)

Why `prometheus-flask-exporter`:
  - Auto-registers `/metrics` endpoint, no manual route.
  - Exposes the histogram + counter + in-flight gauge automatically.
  - Lets domain code register additional counters/gauges without
    touching the exporter (`metrics.counter()`, `metrics.gauge()`).

Multi-process safety:
  - Default registry is per-process. When running under gunicorn with
    multiple workers, set `PROMETHEUS_MULTIPROC_DIR=/var/tmp/prom`
    before starting the worker; the exporter handles multi-process
    aggregation transparently.
"""

from __future__ import annotations

import os
from typing import Optional

try:
    from prometheus_client import CollectorRegistry
    from prometheus_flask_exporter import PrometheusMetrics
    from prometheus_flask_exporter.multiprocess import (
        GunicornInternalPrometheusMetrics,
    )

    _AVAILABLE = True
except Exception:  # pragma: no cover
    CollectorRegistry = None  # type: ignore[assignment]
    PrometheusMetrics = None  # type: ignore[assignment]
    GunicornInternalPrometheusMetrics = None  # type: ignore[assignment]
    _AVAILABLE = False


# Standard latency buckets (seconds). Cover the full range a casual game
# backend should ever see; extra resolution at the lower end where most
# requests live.
DEFAULT_LATENCY_BUCKETS = (
    0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5,
    0.75, 1.0, 2.5, 5.0, 7.5, 10.0, 30.0,
)


def init_metrics(app, *, service_name: str, version: str = "v1.15") -> Optional[object]:
    """Attach Prometheus metrics to a Flask `app`.

    Returns the metrics object so callers can register custom counters:
        metrics = init_metrics(app, service_name="user")
        metrics.counter(
            "user_signup_total",
            "Number of successful signups",
            labels={"plan": lambda: request.json.get("plan", "free")},
        )

    If `prometheus-flask-exporter` is missing or PROMETHEUS_DISABLED=1,
    returns None and adds no routes — useful for unit tests that don't
    want the registry pollution.
    """
    if not _AVAILABLE or os.getenv("PROMETHEUS_DISABLED", "0") == "1":
        return None

    multiproc_dir = os.getenv("PROMETHEUS_MULTIPROC_DIR")
    if multiproc_dir:
        # Multi-process gunicorn: a shared on-disk registry is mandatory.
        cls = GunicornInternalPrometheusMetrics
        registry = None  # exporter manages the multiproc registry
    else:
        cls = PrometheusMetrics
        # Per-app registry so multiple Flask apps in one process (services
        # loaded together in tests, monorepo dev shells) don't collide on
        # the global default registry.
        registry = CollectorRegistry()

    metrics = cls(
        app,
        defaults_prefix="openblock",
        group_by="endpoint",
        buckets=DEFAULT_LATENCY_BUCKETS,
        registry=registry,
    )
    try:
        metrics.info(
            "openblock_service_info",
            "Service build info",
            version=version,
            service=service_name,
        )
    except ValueError:
        # Already registered on a shared registry (e.g. PROMETHEUS_MULTIPROC
        # in dev). Safe to ignore.
        pass
    return metrics
