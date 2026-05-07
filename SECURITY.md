# Security Policy

## Supported Versions

We currently support the latest `main` branch with security fixes. Tagged
releases on or after `v1.14` receive security updates; earlier tags are
considered legacy and will not be patched.

| Version    | Supported          |
| ---------- | ------------------ |
| main       | Yes                |
| v1.14.x    | Yes                |
| < v1.14    | No                 |

## Reporting a Vulnerability

**Please do NOT open public GitHub issues for security vulnerabilities.**

To report a vulnerability:

1. Email **security@openblock.dev** (or the maintainer listed in
   `.github/CODEOWNERS` if email is unavailable) with:
   - A description of the issue and the impact you observed.
   - Steps to reproduce, ideally including a minimal proof-of-concept.
   - Affected version / commit SHA.
   - Your name / handle for credit (optional).
2. We will acknowledge receipt within **3 business days**.
3. We aim to provide an initial assessment within **7 days** and a fix or
   mitigation within **30 days** for high-severity issues, longer for
   complex ones.
4. Once a fix is released, we will credit you in the changelog (unless
   you prefer to remain anonymous).

For especially sensitive disclosures, you may PGP-encrypt to the key
listed at `https://keys.openpgp.org/search?q=security@openblock.dev`
(populate before relying on it for production deployments).

## Disclosure Policy

We follow **coordinated disclosure**:

- We will NOT disclose the vulnerability publicly until a patch is
  available and downstream operators have had a reasonable window to
  upgrade.
- We may publicly acknowledge that an embargoed issue exists once we
  have begun coordinating with affected operators.
- Reporters who follow the policy will not face legal action from the
  project owners (good-faith research is welcome).

## Hardening Checklist for Operators

When deploying OpenBlock services in production, please review:

- `docs/operations/SECURITY_HARDENING.md` — required env, secrets,
  network policy, TLS termination, CORS configuration.
- `docs/operations/DEPLOYMENT.md` — recommended Docker / k8s topology.
- Rotate all secrets from `services/.env.services.example`; values
  prefixed with `REPLACE_ME_` MUST be replaced.
- Enable Redis-backed rate limiting in multi-replica deployments
  (`RATE_LIMIT_BACKEND=redis`).
- Set `OPENBLOCK_DB_DEBUG=0` (default in v1.14) and never expose the
  `/api/db-debug/*` endpoints publicly.
- Constrain CORS via `OPENBLOCK_ALLOWED_ORIGINS`.

## Cryptography

OpenBlock uses well-vetted primitives only:

- **Password hashing**: Argon2id (`argon2-cffi`) with OWASP defaults.
- **Symmetric encryption**: Fernet (AES-128-CBC + HMAC-SHA256) via
  `cryptography`.
- **JWT**: HS256 by default (`PyJWT`), with hooks for RS256.

We do NOT roll our own crypto. The legacy XOR-based "encryption" present
in pre-v1.14 builds is retained only as a one-shot `LegacyXorEncryptor`
class for migrating historical cipher-text and is otherwise disabled.
