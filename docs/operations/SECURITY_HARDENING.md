# Security Hardening (v1.14)

This document is the canonical checklist of v1.14 security changes and
how operators should configure deployments. It complements `SECURITY.md`
(which describes the *policy*) with concrete *operational* steps.

## 1. What changed in v1.14

| Area | Before | After |
| --- | --- | --- |
| Symmetric encryption | XOR + base64 (`services/security/encryption.py`) | **Fernet (AES-128-CBC + HMAC-SHA256)** via `cryptography`. Legacy retained as `LegacyXorEncryptor` (decrypt-only). |
| Password hashing | sha256, no salt | **Argon2id** via `argon2-cffi` with OWASP defaults. PBKDF2-SHA256 fallback only if argon2 missing. |
| Session tokens | Opaque random strings | **JWT (HS256)** access + refresh pair, refresh rotation, revocation list. |
| Payment HMAC | Default `"payment_secret"` fall-back | **Required env**, ≥32 chars; missing/short ⇒ `PaymentConfigError` at boot. |
| Rate limit | Process-local dict | **Pluggable backend**: `InMemoryBackend` (dev) / `RedisBackend` (prod, atomic Lua). |
| CORS | `CORS(app)` (any origin) | **Allow-list** via `OPENBLOCK_ALLOWED_ORIGINS`; default = vite dev origins only. |
| `/api/db-debug/*` | Default ON | **Default OFF**; opt-in via `OPENBLOCK_DB_DEBUG=1`. |
| Compose secrets | Hard-coded `postgres/postgres`, no Redis password | **Required env** via `${VAR:?...}`; Redis enforces `--requirepass`. |
| Containers | Missing | **Dockerfiles** for user/game/analytics/monitoring with non-root user + HEALTHCHECK. |

## 2. Required environment variables

Production deployments must populate all of these (see
`services/.env.services.example` for the full template):

| Variable | Purpose | Constraints |
| --- | --- | --- |
| `ENCRYPTION_KEY` | Fernet key | 44-char url-safe base64 OR any ≥1-char secret (will be SHA-256 hashed) |
| `JWT_SECRET` | JWT signing | ≥32 chars (256 bits) |
| `JWT_ISSUER` / `JWT_AUDIENCE` | JWT claims | Any unique strings, must match across services |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Token lifetimes (s) | access ≤86400; refresh > access |
| `PAYMENT_SECRET_KEY` | Payment callback HMAC | ≥32 chars |
| `POSTGRES_PASSWORD` | Postgres credential | ≥32 chars recommended |
| `REDIS_PASSWORD` | Redis `requirepass` | ≥32 chars recommended |
| `RATE_LIMIT_BACKEND` | `memory` or `redis` | `redis` required for ≥2 replicas |
| `OPENBLOCK_ALLOWED_ORIGINS` | CORS allow-list | Comma-separated origins; never `*` in production |
| `OPENBLOCK_DB_DEBUG` | SQLite debug API | Leave unset / `0` in production |

Generate strong secrets:

```bash
# 32-byte hex (good for JWT_SECRET, PAYMENT_SECRET_KEY, *_PASSWORD)
openssl rand -hex 32

# Fernet key (good for ENCRYPTION_KEY)
python -c 'import cryptography.fernet as f; print(f.Fernet.generate_key().decode())'
```

## 3. Boot-time enforcement

Each security module **fails closed** at construction time:

- `DataEncryptor()` ⇒ `EncryptionConfigError` if `ENCRYPTION_KEY` missing.
- `PaymentVerifier()` ⇒ `PaymentConfigError` if `PAYMENT_SECRET_KEY`
  missing / short.
- `JWTManager()` ⇒ `JWTConfigError` if `JWT_SECRET` missing / <32 chars
  or if TTLs are nonsensical.
- `services/user_service/app.create_app()` propagates the above so a
  misconfigured deployment fails its `/readyz` rollout instead of
  serving traffic.

## 4. Operational migration steps

When upgrading from a pre-v1.14 deployment:

1. **Rotate** all secrets — none of the old defaults remain valid.
2. **Re-encrypt persisted data** that was encrypted with the legacy XOR
   scheme:
   ```python
   from services.security.encryption import LegacyXorEncryptor, DataEncryptor
   plain = LegacyXorEncryptor(key=old_key).decrypt(blob)
   blob_v2 = DataEncryptor().encrypt(plain)
   ```
3. **Re-hash passwords** lazily on next login: legacy sha256 hashes will
   fail `verify`, force users through password reset OR run a one-shot
   migration that prompts re-login.
4. **Switch rate limiter** to Redis: set
   `RATE_LIMIT_BACKEND=redis` and `REDIS_PASSWORD`. Single-replica
   deployments may keep `memory`.
5. **Tighten CORS**: set `OPENBLOCK_ALLOWED_ORIGINS` to the exact public
   web/miniprogram origins.
6. **Disable** `/api/db-debug/*` in production; default is now OFF.

## 5. Network / TLS posture (target)

The current `services/nginx.conf` only does path-based routing. Before
exposing the gateway publicly, add:

- TLS termination (cert-manager or upstream LB).
- `limit_req` zones in front of `/api/auth/*` and `/api/payment/*`
  (defense-in-depth alongside the in-process limiter).
- JWT validation at the gateway (inject upstream verification or use
  `/api/auth/verify` as auth-request subrequest).
- WAF (e.g., ModSecurity, Cloudflare WAF) for known attack signatures.
- mTLS between gateway and internal services if the network is shared.

These are tracked as P1 follow-ups (see `docs/operations/DEPLOYMENT.md`).

## 6. Test coverage

`services/tests/` enforces the above:

- `test_encryption.py` — round-trip, tamper, missing key, legacy decrypt only.
- `test_password.py` — hash/verify, weak password rejection,
  `needs_rehash` policy bump.
- `test_jwt.py` — issue/verify/refresh rotation/revoke, expired,
  missing/short secret.
- `test_payment.py` — HMAC roundtrip, missing/short secret, timestamp
  freshness.
- `test_rate_limit.py` — token-bucket allow/deny, recovery,
  block/unblock, reset.
- `test_user_service.py` — full Flask flow, no user enumeration on
  login, refresh-token replay denied.

CI (`.github/workflows/ci.yml`) runs these on every PR alongside
`pip-audit` (advisory) and `docker compose config` validation.
