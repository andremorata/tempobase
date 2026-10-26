# TempoBase — Current Status

This file captures the current operating posture of the repository. It is not the task tracker; GitHub Issues are the official source for active work.

## Current Posture

- **Product state:** Production-ready full-stack time tracking app.
- **Runtime location:** `app/`.
- **Deployment target:** Vercel with Root Directory set to `app`; Neon PostgreSQL.
- **Work tracking:** GitHub Issues for active bugs, enhancements, hardening, and docs tasks.
- **Historical specs:** Completed phase files live under `specs/archive/phases/` and are not active plans.

## Recent Structural Changes

- Renamed the GitHub repository from `tempobase-lite` to `tempobase` (2026-10-26). The old private `tempobase` repository is archived as `tempobase-legacy`. The Vercel project keeps the name `tempobase-lite`; production runs on `tempobase.pmr.dev`.
- Renamed the executable application folder from `frontend/` to `app/`.
- Added root-level pnpm scripts that delegate to `app/`.
- Replaced scaffold-style agent guidance with TempoBase-specific instructions.
- Added PWA manifest and app icons for installable app support.
- Added stale timer recovery: a `time_entries.last_seen_at` heartbeat, a gap-derived `time_entries.last_session_end_at` recovery point, plus a prompt when a timer is found running from a previous day.
- Moved local phase issue files into the specs archive.
- Added GitHub Issue templates for bugs, features, and maintenance work.
- Vercel Firewall rule `Rate limit password endpoints` (configured in the Vercel dashboard, not in the repo): 10 POSTs per minute per IP on login, registration, password change and self-deletion.
- Unique index `domain_users_email_active_key` on `email` for active users (Prisma `partialIndexes` preview).
- Security hardening from the 2026-10-26 audit: server-side role enforcement per the permissions matrix, per-request session revalidation, Member scoping to own entries, cross-account id checks, shared-link scoping, invite and Owner-role rules, CSV formula escaping, no default `NEXTAUTH_SECRET` in Docker files, and `next` 16.4.3 plus dependency overrides for audit findings.

## Validation Snapshot

Latest local checks from the repository root:

| Check | Status | Notes |
| --- | --- | --- |
| `pnpm --dir app install --frozen-lockfile` | Passed | No ignored-builds warning after `onlyBuiltDependencies` config. |
| `pnpm prisma:validate` | Passed | Prisma schema valid. |
| `pnpm lint` | Passed | Root script delegates to app lint. |
| `pnpm test` | Passed | The intermittent Settings page date-format failure was a test-side race on the portal-rendered select; fixed. |
| `pnpm build` | Not rerun in this pass | Runs `prisma migrate deploy`; requires intentional DB/migration context. |
| `pnpm test:e2e` | Not rerun in this pass | Should be run before release readiness claims. |

## Known Follow-Ups

- Run a deliberate final readiness gate after the current restructuring settles.
- Create GitHub Issues for any remaining production-hardening work that should continue beyond this cleanup.
- Viewers still see the tracker UI; the API rejects their writes with 403.
- `pnpm audit` keeps one high finding: `zod` 3 inside the `shadcn` CLI. No patched 3.x exists and forcing zod 4 breaks the CLI. It never runs in the app.

## Notes For Agents

- Do not treat archived phase files as active scope.
- When work comes from a GitHub Issue, use that issue as the source of acceptance criteria.
- Update this file only when repository posture, validation status, or known risks materially change.
