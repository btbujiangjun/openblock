# Kubernetes Deployment (v1.15)

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

## 1. Cluster prerequisites

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

## 2. Bring-up with plain manifests

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

## 3. Bring-up with Helm

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

## 4. Pod hardening recap

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

## 5. Observability wiring

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

## 6. Rollback

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

## 7. Known limitations (v1.15)

- No `NetworkPolicy` shipped — add in v1.16 (zero-trust between pods).
- No `PodDisruptionBudget` shipped — add when running >2 replicas in
  prod.
- No `ServiceMonitor` / `PodMonitor` — relies on annotation-based
  scraping; switch when adopting Prometheus Operator.
- Migration job is manual — automated `Job` lands in v1.16.
- Helm chart does not yet template Postgres / Redis (we assume managed
  services); add stateful templates when you need to self-host.
