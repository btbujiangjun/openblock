# Observability (v1.15)

OpenBlock services emit **structured logs**, **Prometheus metrics**,
and **OpenTelemetry traces** by default. None of them require code
changes from feature owners — the helpers in `services/common/` wire
themselves into every Flask app at boot.

---

## 1. Metrics (Prometheus)

### What gets recorded automatically

Every service that calls `init_metrics(app, service_name=...)` exposes:

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `openblock_http_request_duration_seconds_*` | histogram | endpoint, method, status | Latency. Buckets cover 5ms..30s. |
| `openblock_http_request_total` | counter | endpoint, method, status | Traffic + error rate denominator. |
| `openblock_flask_http_request_exceptions_total` | counter | endpoint, method | Unhandled-exception rate. |
| `openblock_http_requests_in_progress` | gauge | endpoint | Saturation (in-flight count). |
| `openblock_service_info` | info gauge | version, service | Build identity. |

These cover the four golden signals; SLOs are derived from
`http_request_duration_seconds_bucket` (P95/P99) and the ratio of
`status=5xx` over total traffic.

### Endpoint

`GET /metrics` returns the standard Prometheus exposition format. The
endpoint is unauthenticated; restrict access at the gateway / network
layer (the v1.15 `services/nginx.conf` already locks `/metrics` to
internal CIDRs).

### Multi-process gunicorn

When running with multiple gunicorn workers, set
`PROMETHEUS_MULTIPROC_DIR=/var/tmp/prom` before launching gunicorn so
the exporter aggregates correctly across workers.

### Adding a custom metric

```python
from services.common.metrics import init_metrics

metrics = init_metrics(app, service_name="user")
metrics.counter(
    "user_signup_total",
    "Number of successful signups",
    labels={"plan": lambda: request.json.get("plan", "free")},
)
```

### Disabling

Set `PROMETHEUS_DISABLED=1` to skip registration entirely (used by
tests that don't need /metrics).

---

## 2. Tracing (OpenTelemetry)

### What's auto-instrumented

`init_tracing(app, service_name=...)` enables the standard OTel auto
instrumentations:

- **Flask** — every request becomes a span tagged with route, method,
  status, peer.
- **requests** — outbound HTTP calls become child spans, propagating
  W3C tracecontext (so user-svc → game-svc traces stitch correctly).
- **SQLAlchemy** — when an engine is provided, queries become spans.

### Configuration

OTel honors its standard envs; the most important:

| Env | Effect |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP target (e.g. `https://otel.example.com`). Empty ⇒ no export. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Header pairs (e.g. `x-honeycomb-team=xxx`). |
| `OTEL_SERVICE_NAME` | Override the auto-derived `openblock-<name>`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Resource KVs (e.g. `deployment.environment=prod`). |
| `OTEL_CONSOLE=1` | Print spans to stdout (dev only). |
| `OTEL_DISABLED=1` | Skip OTel entirely. |

### Manual spans

```python
from services.common.tracing import get_tracer

tracer = get_tracer(__name__)
with tracer.start_as_current_span("billing.charge_card") as span:
    span.set_attribute("user_id", user_id)
    ...
```

`get_tracer()` returns a NoOp tracer if OTel is unavailable, so
sprinkling spans never breaks tests.

### Cost

With no exporter configured, OTel produces span objects but never
serializes them — the overhead is sub-millisecond per request and was
benchmarked acceptable for the casual-game RPS. Enable export only in
staging and production.

---

## 3. Logging (structlog)

`services.common.logging.setup_logging` is the entry point used by
every service module via `get_logger(__name__)`. Output format:

- **stdout**, JSON when `LOG_LEVEL=INFO` or higher in production.
- **stdout**, key=value when run interactively for dev readability.

Mandatory fields per log line:

- `time` — ISO-8601 UTC.
- `level` — INFO/WARN/ERROR.
- `service` — set from env `OTEL_SERVICE_NAME` or service module.
- `request_id` — if available (gateway propagates `X-Request-Id`).

Sensitive fields are masked before logging via
`services.security.encryption.DataMasker`.

---

## 4. Alerting

Prometheus rules ship as suggestions in `docs/operations/alerts.yml`
(future addition). Until then, the canonical SLOs are:

| SLO | Threshold | Window |
| --- | --- | --- |
| Auth login P95 latency | < 500ms | 5min |
| Auth login error rate | < 1% | 5min |
| Game session create P95 | < 300ms | 5min |
| Token refresh failure rate | < 0.5% | 5min |
| Memory RSS | < 80% of limit | 5min |
| Pod restart count | < 3 in 1h | 1h |

Translate these into PrometheusRule objects when you onboard the
cluster's alertmanager.

---

## 5. Verifying locally

```bash
# Boot the user service (see SECURITY_HARDENING.md for env)
PYTHONPATH=. ENCRYPTION_KEY=... JWT_SECRET=... PAYMENT_SECRET_KEY=... \
  python -m services.user_service.app

# In another shell
curl -s localhost:8001/metrics | head -20
curl -s localhost:8001/openapi.json | jq '.paths | keys'
open http://localhost:8001/docs   # Swagger UI
```

---

## 6. Roadmap

- v1.16: PrometheusRule yaml + Grafana dashboards in
  `docs/operations/dashboards/`.
- v1.16: Sentry SDK auto-init when `SENTRY_DSN` is set.
- v1.16: OpenTelemetry log instrumentation (logs → traces correlation).
