# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (v1.16 — Pressure-Strategy Coherence)
- **`web/src/boardTopology.detectNearClears(grid, opts)`**: 「近完整行/列」检测的
  单一来源（返回 `{ rows, cols, nearFullLines, close1, close2 }`）。
  `analyzeBoardTopology` 与 `bot/blockSpawn.analyzePerfectClearSetup`
  现在共享同一实现，避免「近满 N」与 `pcSetup`/`multiClearCandidates`
  在不同视图下走调（这是 v1.15 之前 stress=0.89 + 多消候选=0 + 闭环=+0.190
  三者互相矛盾的根因）。
- **`adaptiveSpawn._stressBreakdown.occupancyDamping`**: 在 stress clamp
  之后、smoothing 之前对正向 stress 乘 `clamp(boardFill/0.5, 0.4, 1.0)`。
  低占用盘面（如 fill=0.39）的伪高压由 0.89 → ~0.69，进入 `tense` 而非
  `intense`。负向 stress（救济）不被衰减。
- **`spawnHints.spawnIntent` 枚举**：`relief / engage / pressure / flow /
  harvest / maintain` —— 出块意图的单一对外口径。`stressMeter.buildStoryLine`、
  `monetization/personalization.updateRealtimeSignals`、回放标签都读这同
  一字段，不再各自推断；同时通过 `_lastAdaptiveInsight.spawnIntent` 暴露
  给 panel。
- **AFK 召回路径 (`engage`)**: `adaptiveSpawn` 在 `profile.metrics.afkCount ≥ 1`
  且 `stress < 0.55`、无救济触发时，主动提升 `clearGuarantee≥2 / multiClearBonus≥0.6 /
  multiLineTarget≥1 / diversityBoost≥0.15` 并把 rhythmPhase 从 `neutral`
  切到 `payoff`，给玩家「显著正反馈 + 可见目标」而非纯泄压。
- **`stressMeter.SPAWN_INTENT_NARRATIVE`**: spawnIntent → 玩家叙事的单一映射，
  `buildStoryLine` 优先取该映射；只在 `boardRisk≥0.6` 或挫败/恢复主导时被覆盖。
- **`playerInsightPanel` 新增「意图」pill**：直接显示当前 spawnIntent；
  「闭环」改名为「闭环反馈」并刷新 tooltip，明确强调它衡量「近期奖励是否
  高于预期」，与「近满 N / 多消候选」无关。

### Changed (v1.16 — Pressure-Strategy Coherence)
- **`PlayerProfile.momentum` 加噪声衰减**：在样本置信度之外再乘 `noiseDamping =
  clamp(1 - (var_old + var_new), 0.5, 1)`（伯努利方差噪声）。两半区
  接近 50/50 时 momentum 被收窄到原值的 0.5，避免「我状态稳定，UI 却显示
  动量 +1」。文档同时澄清 momentum **完全基于消行率**而非分数增量。
- **`monetization/personalization.updateRealtimeSignals(profile, extras?)`**：
  新增第二参数 `extras.spawnIntent`，由 `commercialInsight` 在 `spawn_blocks`
  事件中传入，实现策略文案与出块意图同源。

### Tests (v1.16)
- **`tests/boardTopology.test.js` (新增 6)**：detectNearClears 空盘 / close1 /
  close2 / requireFillable / 与 analyzeBoardTopology 一致 / maxEmpty。
- **`tests/adaptiveSpawn.test.js` (新增 8)**：occupancyDamping 衰减 /
  救济场景不衰减 / harvest intent / relief intent / AFK engage 提升 hints /
  AFK engage 让位 relief / momentum 噪声衰减 / spawnIntent 始终落入合法枚举。
- **总测试数**：720 → **734**（全部通过）。

### Added (v1.15)
- **Observability — metrics**: `services/common/metrics.py` (Prometheus
  Flask exporter); auto-attached to user / game / analytics services;
  monitoring service keeps its bespoke `/metrics`. Per-app
  `CollectorRegistry` so multiple apps in one process don't collide.
  Standard latency buckets (5ms..30s).
- **Observability — tracing**: `services/common/tracing.py` (OpenTelemetry
  SDK + Flask + requests + SQLAlchemy auto-instrumentation). Default
  is no-op; ship via OTLP/HTTP by setting
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **API documentation**: `services/user_service/openapi.py` (apispec +
  marshmallow). Spec at `GET /openapi.json`, Swagger UI at `GET /docs`.
  Routes carry YAML docstrings; reusable schemas in
  `components/schemas`.
- **Database layer**: `services/common/orm.py` (SQLAlchemy 2.0 base +
  engine factory + `session_scope` helper).
  `services/user_service/orm_models.py` (`UserOrm`, `SessionOrm`).
  `services/user_service/sql_repository.py` (`SqlUserRepository`) — same
  interface as `_MemoryRepo`, plug-in via `USE_POSTGRES=true`.
- **Alembic**: `services/alembic.ini`, `services/migrations/env.py`,
  baseline revision `e0ef3caf345f` covering `users` + `user_sessions`.
  CI fails on schema drift via the `alembic-check` job.
- **k8s manifests**: `k8s/base/{namespace,configmap,secret,user,game,analytics,monitoring,ingress}`.
  All deployments use non-root, read-only-rootfs, `cap_drop=ALL`,
  seccomp `RuntimeDefault`, HPA on user + game.
- **Helm chart**: `k8s/helm/openblock/` with `values.yaml`, templated
  Deployment / Service / HPA / ConfigMap / Ingress.
- **nginx hardening**: `services/nginx.conf` rewritten with
  per-route `limit_req` zones (auth/payment/api), security headers,
  per-upstream circuit breaker (`max_fails`/`fail_timeout`), JSON
  access log, `auth_request` subrequest hook to `/api/auth/verify`,
  TLS termination block scaffolded behind `# tls` markers.
- **Web bundle splitting**: `vite.config.js` `manualChunks` cuts the
  main `index.js` from 500 KB → 230 KB (-54%). New chunks: `meta`
  (player insights, monetization, panels) and `rl` (bot training).
  Enforced by `scripts/check-bundle-size.mjs` in CI.
- **Tests**: `services/tests/test_metrics.py`, `test_tracing.py`,
  `test_openapi.py`, `test_sql_repository.py`. Total 69 services tests
  passing.
- **CI**: `bundle-size` step in the web job, `alembic-check` job
  (autogenerate diff must be empty).
- **Docs**: `docs/operations/OBSERVABILITY.md`,
  `docs/operations/K8S_DEPLOYMENT.md`. Updated `DEPLOYMENT.md`,
  `ARCHITECTURE.md`.
- **Dependencies** (`services/requirements.txt`): `alembic`,
  `prometheus-flask-exporter`, OpenTelemetry stack
  (`opentelemetry-api`, `opentelemetry-sdk`,
  `opentelemetry-instrumentation-{flask,requests,sqlalchemy}`,
  `opentelemetry-exporter-otlp-proto-http`), `apispec`,
  `apispec-webframeworks`, `marshmallow`.

### Added (v1.14)
- **services/Dockerfile.{user,game,analytics,monitoring}**: production-grade
  container images using `python:3.11-slim`, non-root `app` user, and
  HEALTHCHECK against `/health`.
- **services/.env.services.example**: template for the secrets that
  `services/docker-compose.yml` now requires (all `${VAR:?...}` style).
- **services/security/jwt_tokens.py**: JWT (PyJWT) issuance + verification
  with refresh rotation, pluggable `RevocationStore` and required claims.
- **services/security/password.py**: Argon2id password hashing module
  (`PasswordHasher.hash` / `verify` / `needs_rehash`) with OWASP defaults.
- **services/security/rate_limit.py**: pluggable `RateLimitBackend` API
  with `InMemoryBackend` (dev) and `RedisBackend` (production, atomic Lua).
- **services/tests/**: pytest suites for encryption, password, JWT,
  payment, rate limit and the user-service Flask app (in-memory repo).
- **.github/dependabot.yml**: weekly updates for npm, pip, Docker and
  GitHub Actions.
- **CI**: new `python-services` (pytest + pip-audit), `npm-audit`,
  `docker-compose-config` jobs in `.github/workflows/ci.yml`.
- **SECURITY.md**, **CHANGELOG.md**, **CODE_OF_CONDUCT.md**,
  **.github/CODEOWNERS**, PR / Issue templates.
- **docs/operations/SECURITY_HARDENING.md** and
  **docs/operations/DEPLOYMENT.md** describing the v1.14 production posture.

### Changed
- **services/security/encryption.py**: replaced XOR + Base64 obfuscation
  with **Fernet** (AES-128-CBC + HMAC-SHA256). The previous scheme is
  retained as `LegacyXorEncryptor` for one-shot migration only and its
  `encrypt()` is disabled.
- **services/security/payment.py**: removed the silent fall-back to a
  hard-coded `payment_secret`. `PaymentVerifier` now raises
  `PaymentConfigError` if `PAYMENT_SECRET_KEY` is missing or shorter than
  32 chars.
- **services/user_service/app.py**: rewritten on top of Argon2id +
  JWTs. `/api/auth/login` now actually verifies passwords and returns a
  JWT pair; `/api/auth/refresh` rotates refresh tokens and revokes the
  old one; `/api/auth/verify` exposes a token-introspection endpoint for
  the gateway.
- **services/docker-compose.yml**: every credential is sourced from
  `.env`, Postgres + Redis publish through configurable host ports, and
  Redis now requires `--requirepass`. `depends_on` waits on healthchecks.
- **server.py**: CORS now defaults to a tight allow-list (vite dev
  origins) and is configurable via `OPENBLOCK_ALLOWED_ORIGINS`. The
  `/api/db-debug/*` endpoints default to **disabled**; set
  `OPENBLOCK_DB_DEBUG=1` to opt in for local debugging.
- **requirements.txt** + **services/requirements.txt**: pinned versions
  for `argon2-cffi`, `cryptography`, `PyJWT`, `redis`, `structlog`,
  `prometheus-client`, `sentry-sdk[flask]`.

### Security
- **CVE class fixed**: insecure default secret in payment callback
  verification (forgeable callbacks).
- **CVE class fixed**: weak password hashing (sha256, no salt).
- **CVE class fixed**: opaque random tokens replaced with revocable JWTs.
- **CVE class fixed**: wildcard CORS replaced with allow-list.
- **CVE class fixed**: SQLite debug API exposed by default.
- **Hardening**: encryption requires explicit key; in-memory rate limit
  emits a warning so operators notice in multi-replica deployments.
