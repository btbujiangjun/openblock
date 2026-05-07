# Deployment Guide (v1.14)

This guide describes the recommended ways to run OpenBlock in
development, staging and production. It covers the **monolith**
(`server.py` + `web/`) and the **microservice mesh** under `services/`,
both of which can be deployed independently.

> Pair this guide with `docs/operations/SECURITY_HARDENING.md`. Anything
> in production must satisfy that checklist first.

## 1. Topologies

```
┌─────────────────────────────┐
│  Web (vite build) / Mini    │
│  /  Mobile clients          │
└──────────────┬──────────────┘
               │ HTTPS
       ┌───────▼────────┐
       │ Edge LB / CDN  │  TLS termination, WAF, edge rate-limit
       └───────┬────────┘
               │
   ┌───────────┴────────────┐
   │ Gateway (nginx alpine) │
   └───┬─────────┬─────────┬┘
       │         │         │
       ▼         ▼         ▼
  user-svc   game-svc   analytics-svc   monitoring-svc
       │         │         │                  │
       └────┬────┘         │                  │
            ▼              │                  │
       ┌────────┐    ┌─────▼──────┐    ┌──────▼─────┐
       │  Postgres │  │  Redis      │    │  Prometheus│
       └────────┘    └─────────────┘    └────────────┘
```

For *single-node* casual deployments (recommended starting topology),
the legacy monolith `server.py` plus the new microservices co-exist on
the same host; the gateway routes `/api/*` to the monolith and
`/svc/*` to the new services.

## 2. Local development

### 2.1 Frontend + monolith (fastest)
```bash
npm install
npm run dev          # starts vite on http://localhost:5173
# in another shell
python3 server.py    # Flask on http://localhost:3000
```

### 2.2 Microservice mesh (compose)

```bash
cp services/.env.services.example .env
# edit .env: replace every REPLACE_ME_* value
docker compose -f services/docker-compose.yml up --build
```

Compose will refuse to start if any required secret is empty
(`${VAR:?}` ⇒ "VAR required"). This is intentional.

Healthchecks are wired up:

```bash
docker compose -f services/docker-compose.yml ps
# look for "healthy" in the STATUS column
```

### 2.3 Run only one service for fast iteration

```bash
PYTHONPATH=. ENCRYPTION_KEY=... JWT_SECRET=... PAYMENT_SECRET_KEY=... \
  python -m services.user_service.app
```

## 3. Staging / production rollout

1. **Provision secrets** in your secret manager (AWS SM / Vault / k8s
   `Secret`). Never commit to git.
2. **Build images** with deterministic tags:
   ```bash
   docker build -f services/Dockerfile.user -t ghcr.io/openblock/user:1.14.0 .
   docker build -f services/Dockerfile.game -t ghcr.io/openblock/game:1.14.0 .
   docker build -f services/Dockerfile.analytics -t ghcr.io/openblock/analytics:1.14.0 .
   docker build -f services/Dockerfile.monitoring -t ghcr.io/openblock/monitoring:1.14.0 .
   ```
3. **Push** to your registry (`docker push ...`).
4. **Deploy** with the orchestrator of your choice:
   - `docker compose` for single-node.
   - `nomad` / `swarm` for small clusters.
   - **k8s** (recommended for multi-replica) — Helm chart is a P1
     follow-up; until then use plain manifests with the same env vars.
5. **Wire health probes**: liveness `/livez`, readiness `/readyz`,
   service health `/health`. Each Dockerfile already declares a
   `HEALTHCHECK` for non-orchestrated docker.
6. **Enable Redis-backed rate limit** (`RATE_LIMIT_BACKEND=redis`) once
   you run more than one replica.
7. **Edge configuration**: TLS, WAF, edge rate-limit, geo-routing
   (Cloudflare / ALB / nginx-ingress).

## 4. Smoke tests after rollout

```bash
# 1. Health
curl -fsS https://api.openblock.dev/health
# 2. Create user
curl -X POST https://api.openblock.dev/api/users \
  -H 'content-type: application/json' \
  -d '{"username":"smoke","email":"smoke@x.com","password":"CorrectHorseBatteryStaple"}'
# 3. Login (expect token pair)
curl -X POST https://api.openblock.dev/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"smoke","password":"CorrectHorseBatteryStaple"}'
```

If `/api/auth/login` returns a JWT pair and the access token verifies
through `/api/auth/verify`, the v1.14 auth path is working end-to-end.

## 5. Rolling back

- Containers are **immutable** — to roll back, redeploy the previous
  image tag. No DB migration is required for the v1.14 security
  changes (they are all in the auth & secrets layer).
- Re-encryption of historical data is a one-shot **forward-only**
  migration; keep the legacy XOR key in your secret manager for at
  least one release after migration is confirmed complete, then rotate
  it out.

## 6. Observability

- **Logs**: each service uses `services.common.logging.setup_logging`,
  which emits structured JSON when `LOG_LEVEL=INFO` and stdout-line on
  dev. Ship to your log pipeline (ELK / Loki / Datadog).
- **Metrics**: `services/monitoring/app.py` exposes Prometheus-compatible
  series; future work will add `prometheus-client` instrumentation
  inside each service.
- **Errors**: set `SENTRY_DSN` in `.env` to enable Sentry capture.
- **Traces**: OpenTelemetry instrumentation is a P1 follow-up.

## 7. Roadmap

### Shipped in v1.15
| Item | Doc |
| --- | --- |
| Helm chart + k8s manifests | `docs/operations/K8S_DEPLOYMENT.md` |
| OpenAPI 3.0 spec + Swagger UI | `services/user_service/openapi.py` |
| SQLAlchemy 2.0 + Alembic baseline | `services/migrations/`, `services/common/orm.py` |
| Prometheus auto-instrumentation (4 services) | `docs/operations/OBSERVABILITY.md` |
| OpenTelemetry tracing (Flask + requests + SQLAlchemy) | `docs/operations/OBSERVABILITY.md` |
| Gateway hardening (`limit_req`, security headers, auth_request hook) | `services/nginx.conf` |
| Web bundle code-split (500 → 230 KB main) + bundle-size CI gate | `vite.config.js`, `scripts/check-bundle-size.mjs` |

### Pending (v1.16+)
| Item | Owner | Target |
| --- | --- | --- |
| Playwright E2E tests | qa | v1.16 |
| WAF (ModSecurity) at gateway | security | v1.16 |
| mTLS between gateway and services | security | v1.16 |
| Sentry SDK auto-init when DSN present | devops | v1.16 |
| Prometheus rules + Grafana dashboards | devops | v1.16 |
| `NetworkPolicy` + `PodDisruptionBudget` | devops | v1.16 |
| Migration `Job` template (Helm + base) | backend | v1.16 |
| `ServiceMonitor` for Prometheus Operator | devops | v1.16 |
| HMAC → RS256 JWT (multi-region key dist) | security | v1.16 |
| OpenAPI client SDK generation (TypeScript / Python) | backend | v1.17 |
| OLAP data warehouse pipeline | data | v1.17 |
