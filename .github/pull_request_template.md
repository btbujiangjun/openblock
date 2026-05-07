# Pull Request

## Summary
<!-- 1-3 sentences. What does this PR do, and why? -->

## Type of change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Refactor / chore (no functional change)
- [ ] Docs only
- [ ] Security fix

## Linked issues
<!-- Closes #123, Fixes #456 -->

## Test plan
- [ ] Unit tests added / updated (web `vitest run`, services `pytest services/tests`)
- [ ] Manual smoke run (describe steps below)
- [ ] Linter passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

```text
<paste exact commands you ran and their results>
```

## Security checklist
- [ ] No secrets / tokens / private URLs added to git
- [ ] No credentials hard-coded; new env vars documented in `.env.example` or `.env.services.example`
- [ ] No new dependency with known high-severity advisories (`npm audit --omit=dev` / `pip-audit`)
- [ ] If touching `services/security/*`: tests updated; security reviewer requested

## Operational impact
- [ ] No infra change
- [ ] Schema / migration change (note in `enterprise_extensions.py` or DB notes)
- [ ] Public API change (note in CHANGELOG)
- [ ] Container / compose change (note in `docs/operations/DEPLOYMENT.md`)

## Screenshots / recordings
<!-- For UI changes only. Drag & drop or paste image URLs. -->
