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
- Local MCP read access (issue #24): personal read tokens in `integration_tokens` (hash only, expiring, revocable, revoked on password change), Bearer routes under `/api/integrations/v1/*`, a Settings > Integrations card, and the `extensions/tempobase-mcp` stdio server (`get_my_hours`, `search_projects`, `list_my_time_entries`). Summary report round-up now rounds per entry, matching the Reports page.
- MCP entry creation with confirmation (issue #25): opt-in `create` token scope, `integration_operations` table, `POST`/`GET /api/integrations/v1/operations`, a confirmation page at `/integrations/operations/[id]` with session confirm/cancel routes, and MCP tools `prepare_time_entry` and `get_operation_status`. The manual-entry rules of `POST /api/time-entries` moved to `app/src/lib/time-entries/manual-entry.ts`. Sign-in now returns to the page that sent the user to `/login` (same-origin `?next=`).
- MCP entry correction with confirmation (issue #26): opt-in `correct` token scope, `correct_entry` operations on the same table (no migration), before/after preview on `/integrations/operations/[id]`, and the MCP tool `prepare_time_entry_correction`. Confirm writes only the requested fields and only while the entry still matches the preview; otherwise it returns 409 `entry_changed` and refreshes the preview for a new confirmation.
- CSV import reopened to Manager and Member: entries stay owned by the importer, rows outside the user's project/task access are flagged on parse and rejected on execute, and execute now rejects task ids from another account or project.

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
- `time_entries.entry_date` is derived with `setHours(0,0,0,0)` in the server's timezone when entries are created or updated, not the user's timezone. Reports and the MCP filter by this stored date.
- The Reports page rounds per entry from the Detailed report, capped at 500 entries per period.
- The Reports page has no user filter, so Owner, Admin and Manager cannot compare their own totals there with the MCP; use `/api/reports/summary?userId=`.
- `pnpm audit` keeps one high finding: `zod` 3 inside the `shadcn` CLI. No patched 3.x exists and forcing zod 4 breaks the CLI. It never runs in the app.

## Notes For Agents

- Do not treat archived phase files as active scope.
- When work comes from a GitHub Issue, use that issue as the source of acceptance criteria.
- Update this file only when repository posture, validation status, or known risks materially change.
