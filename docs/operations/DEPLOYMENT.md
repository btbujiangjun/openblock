# Deployment Guide

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
| Helm chart + k8s manifests | `docs/operations/本文「Kubernetes 部署」` |
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

---

## 8. 合规与运维 SOP

> 非法律意见；上线前应交由法务审核。**删除用户**操作不可逆，需二次确认。

### 8.1 隐私与同意

首次加载可通过自有 CMP / 横幅收集同意主题（分析、广告个性化等）。
调用 `POST /api/compliance/consent`，body：`{ "user_id": "...", "consents": { "analytics": true, "ads": false } }`。
日志中对 `user_id`、订单号采用掩码。

### 8.2 数据主体请求

| 操作 | API | headers |
|------|-----|---------|
| 导出 | `GET /api/compliance/export-user?user_id=` | `X-Ops-Token` |
| 删除 | `POST /api/compliance/delete-user` JSON `{ user_id }` | `X-Ops-Token` |

删除范围：`behaviors`、`scores`、`sessions`、`user_consents`、`user_stats`（可按法务要求扩展）。

### 8.3 备份与恢复（SQLite）

1. 停写或低峰执行：`cp openblock.db openblock-$(date +%Y%m%d).bak`
2. WAL 模式建议同时备份 `-wal` / `-shm` 或执行 `PRAGMA wal_checkpoint(FULL)` 后备份单文件。
3. 恢复：替换 db 文件后重启进程。

### 8.4 事故回滚

1. 设置 `OPENBLOCK_ACTIVE_STRATEGY_VERSION` 指向已知稳定版本 id。
2. RL：切换 `RL_CHECKPOINT_SAVE` 指向旧 checkpoint 并重启服务。
3. 远程配置：`OPENBLOCK_REMOTE_CONFIG_JSON` 紧急覆盖广告频控等开关。

### 8.5 未成年人

上架渠道（苹果、微信等）的年龄分级与付费限制需在产品层单独实现；本仓库提供后端订单审计占位。


---

## Kubernetes 部署

Two parallel deployment paths are supported:

1. **Plain manifests** under `k8s/base/` — for clusters that don't run
   Helm or for review-friendly diffs.
2. **Helm chart** under `k8s/helm/openblock/` — for templated,
   multi-environment rollouts.

Both produce the same final shape: 4 Flask deployments
(`user`, `game`, `analytics`, `monitoring`), each behind a ClusterIP
Service, with a single Ingress fronting them, and HPA scaling
`user` / `game` on CPU.

---

### 1. Cluster prerequisites

- Kubernetes 1.27+
- An ingress controller (default manifests assume
  `ingress-class: nginx`).
- `cert-manager` if you want TLS via the ClusterIssuer hook.
- A way to provision Postgres + Redis (managed services preferred —
  this chart does **not** bundle them).
- A way to deliver `Secret/openblock-secrets`:
  - **External Secrets Operator** (recommended) syncing from AWS SM /
    Vault / GCP SM.
  - **SealedSecrets** for git-encrypted in-repo storage.
  - **sops + helm-secrets** if you prefer file-based.

---

### 2. Bring-up with plain manifests

```bash
# 1. Namespace + non-secret config
kubectl apply -f k8s/base/00-namespace.yaml
kubectl apply -f k8s/base/11-configmap.yaml

# 2. Secret — replace every PLACEHOLDER first; better, generate via your secret manager
cp k8s/base/10-secret.example.yaml /tmp/secret.yaml
$EDITOR /tmp/secret.yaml          # populate
kubectl apply -f /tmp/secret.yaml

# 3. Workloads
kubectl apply -f k8s/base/20-user-service.yaml
kubectl apply -f k8s/base/21-game-service.yaml
kubectl apply -f k8s/base/22-analytics-service.yaml
kubectl apply -f k8s/base/23-monitoring-service.yaml

# 4. Ingress (edit host / TLS first)
kubectl apply -f k8s/base/30-ingress.yaml

# 5. Smoke
kubectl -n openblock get pods -w
kubectl -n openblock port-forward svc/user-service 8001:8001 &
curl http://localhost:8001/health
```

Run the database migration before traffic flows:

```bash
# Run from any pod / job that has the services image, with DATABASE_URL
# pointing at your Postgres:
DATABASE_URL=postgresql://... \
  alembic -c services/alembic.ini upgrade head
```

A `Job` manifest for migrations will land in v1.16; until then run
this from a one-shot pod.

---

### 3. Bring-up with Helm

```bash
helm install openblock k8s/helm/openblock \
  --namespace openblock --create-namespace \
  --values k8s/helm/openblock/values.yaml \
  --values k8s/helm/openblock/values-prod.yaml   # your env override
```

`values-prod.yaml` is not committed; it should set:

- `global.imageRegistry`, `global.imageTag`
- `ingress.host`, `ingress.tls.enabled: true`, `ingress.tls.secretName`
- `config.otelExporterOtlpEndpoint`
- Per-service `replicas` and `resources`

The Secret named in `secret.externalName` (default `openblock-secrets`)
must exist in the namespace before install — the chart only references
it.

Upgrade later with:

```bash
helm upgrade openblock k8s/helm/openblock -n openblock \
  --values k8s/helm/openblock/values.yaml \
  --values k8s/helm/openblock/values-prod.yaml
```

---

### 4. Pod hardening recap

Both manifest sets ship with:

- `runAsNonRoot: true`, `runAsUser: 1000`
- `readOnlyRootFilesystem: true` (writable `tmp` mount only)
- `allowPrivilegeEscalation: false`
- `capabilities.drop: ["ALL"]`
- `seccompProfile: RuntimeDefault`
- `automountServiceAccountToken: false`

Resource requests/limits are conservative; tune via Helm
`services.<name>.resources` once you have RPS data.

---

### 5. Observability wiring

Each Deployment carries the standard Prometheus scrape annotations:

```yaml
prometheus.io/scrape: "true"
prometheus.io/port:   "<service port>"
prometheus.io/path:   "/metrics"   # /metrics/prometheus for monitoring
```

If your cluster uses **Prometheus Operator**, ship a `ServiceMonitor`
per service (template TBD in v1.16). For ad-hoc Prometheus, the
annotations are picked up by the standard `kubernetes-pods` job.

For tracing, set `OTEL_EXPORTER_OTLP_ENDPOINT` in the ConfigMap; the
services pick it up via `envFrom` automatically.

---

### 6. Rollback

```bash
# Plain manifests:
kubectl -n openblock rollout undo deployment/user-service

# Helm:
helm rollback openblock <REVISION>
```

The v1.15 changes are migration-additive (no destructive table
changes); rolling back the application image is safe without a DB
downgrade.

---

### 7. Known limitations (v1.15)

- No `NetworkPolicy` shipped — add in v1.16 (zero-trust between pods).
- No `PodDisruptionBudget` shipped — add when running >2 replicas in
  prod.
- No `ServiceMonitor` / `PodMonitor` — relies on annotation-based
  scraping; switch when adopting Prometheus Operator.
- Migration job is manual — automated `Job` lands in v1.16.
- Helm chart does not yet template Postgres / Redis (we assume managed
  services); add stateful templates when you need to self-host.
