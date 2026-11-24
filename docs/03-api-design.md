# TempoBase — API Design

> API conventions for Route Handlers.

## 1. Scope

- Protocol: HTTPS + JSON
- Runtime: Next.js Route Handlers under `app/src/app/api/`
- Primary consumer: TempoBase frontend
- Auth model: Auth.js session cookies for authenticated app requests

## 2. Authentication Model

### Public auth endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create account and owner user |
| POST | `/api/auth/register-invite` | Accept invite into an existing account |
| GET/POST | `/api/auth/[...nextauth]` | Auth.js credentials and session flow |

### Authenticated auth endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/change-password` | Change current user password. Also revokes the user's integration tokens. |

### Required request context

| Item | Required | Notes |
| --- | --- | --- |
| `Content-Type: application/json` | For JSON bodies | Standard request body format |
| Auth.js session cookie | For protected routes | Sent automatically by the browser |

### Authorization

- Every request re-reads the user from the database in the Auth.js `jwt` callback. Removal, deactivation, role changes and password changes apply immediately; a password change signs out every session.
- Handlers enforce the permissions matrix in `docs/05-business-rules.md` with `requireRole` and the helpers in `app/src/lib/auth/helpers.ts` (`requireManager`, `requireTracker`, `requireOwnerOrAdmin`, `requireOwner`). Role groups live in `app/src/lib/auth/roles.ts`.
- Members only read and write their own time entries; `applyAccessFilter` in `app/src/lib/auth/access.ts` scopes lists and reports. Managers and above write other users' entries.
- Ids received in a body (project, task, tag, client) are checked against the caller's account with `refsBelongToAccount`.
- Public shared reports apply the creator's current scope and amounts permission at view time.
- Auth failures return 401/403 through `authErrorResponse`, not 500.

### Integration tokens (local MCP)

Personal tokens let the local TempoBase MCP (`extensions/tempobase-mcp`) call the API without Auth.js cookies. Scopes: `read` (always), `create` (opt-in, prepares new entries) and `correct` (opt-in, prepares changes to existing entries). The user confirms every write in the app.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/account/integration-tokens` | Session | List the caller's non-revoked tokens (no hash, no token) |
| POST | `/api/account/integration-tokens` | Session | Issue a token: `{ name, expiresInDays, scopes? }` (1 to 90 days, default 30; `scopes` may add `create` and `correct`, refused with 403 for Viewer). `read` is always granted. Returns the plain token once. Audited. |
| DELETE | `/api/account/integration-tokens/[id]` | Session | Revoke one of the caller's tokens. Audited. |
| GET | `/api/integrations/v1/hours` | Bearer | Total and billable hours: `from`, `to` (YYYY-MM-DD, required), `projectId`, `taskId`, `description`, `roundUp` |
| GET | `/api/integrations/v1/projects` | Bearer | Accessible projects and their accessible registered tasks: `q`, `limit` (default 50, max 100); returns `hasMore` |
| GET | `/api/integrations/v1/time-entries` | Bearer | The caller's own entries, newest first (ties broken by id): `from`, `to`, `projectId`, `taskId`, `description`, `page`, `pageSize` (max 100); returns `hasMore` |
| POST | `/api/integrations/v1/operations` | Bearer `create` or `correct` | Prepare a manual entry (`create`): `{ idempotencyKey, startTime, endTime, description?, projectId?, taskId?, isBillable }` (ISO UTC instants). Or prepare a correction (`correct`): `{ kind: "correct_entry", idempotencyKey, entryId, startTime?, endTime?, description?, projectId?, taskId?, isBillable? }` with only the fields to change (`null` clears description, project or task). Writes no entry. Returns the operation (201, or 200 for a repeated key, re-opening a cancelled or expired one) with `confirmUrl` |
| GET | `/api/integrations/v1/operations/[id]` | Bearer, scope of the operation's kind | Status of the caller's own operation; `entryId` once confirmed, or the corrected entry |
| GET | `/api/account/integration-operations/[id]` | Session | Preview of the caller's own operation |
| POST | `/api/account/integration-operations/[id]/confirm` | Session | Create the entry or apply the correction. Audited |
| POST | `/api/account/integration-operations/[id]/cancel` | Session | Discard a pending operation. Audited |

- Tokens look like `tbp_<43 base64url chars>`. Only the SHA-256 hex hash is stored.
- `authenticateIntegration` in `app/src/lib/auth/integration-tokens.ts` runs on every call. It rejects unknown, expired or revoked tokens, inactive or removed users and deleted accounts with 401, and a missing scope with 403. It then re-reads project/task access with `getMemberAccess`.
- Integration routes always scope entries to the token owner, also for Owner and Admin. A `projectId` or `taskId` outside the caller's account or access returns 404. A task is in scope only when its project is too, and it must belong to `projectId` when both are given.
- `from` and `to` must be real calendar dates (`YYYY-MM-DD`); anything else returns 400.
- `hours` uses the Summary report aggregation (`app/src/lib/reports/summary.ts`), so it matches `/api/reports/summary?userId=<owner>` for the same period, filters and `roundUp`.
- Integration responses never contain amounts or rates.

### Integration operations (create with confirmation)

The `create` scope never writes an entry by itself. The MCP prepares an operation, and the same user confirms it on `/integrations/operations/[id]` while signed in.

- Prepare applies the rules of `POST /api/time-entries` (`app/src/lib/time-entries/manual-entry.ts`): refs in the account and access, active project, end after start, at most 24 hours. A `taskId` also needs its own `projectId`. Viewer gets 403.
- The same token and `idempotencyKey` return the existing operation. A cancelled or expired one is re-opened as `pending` with a fresh `expiresAt`, after the entry rules are checked again; the conditional update never touches a confirmed operation. The same key with a different entry returns 409. The MCP derives the key from the entry, so a retry after a connection failure cannot create a second entry.
- An operation expires 15 minutes after it is prepared. `expired` is computed from `expiresAt`; the row stays `pending`.
- Operation views carry `status` (`pending`, `confirmed`, `cancelled`, `expired`), the entry preview with project and task names, the token name and prefix, `entryId`, and `entryDeleted` (true when the confirmed entry was deleted afterwards; a new `idempotencyKey` creates it again). `confirmUrl` never contains a credential.
- Only the operation's user sees it: another user of the same account (also Owner/Admin) or another account gets 404.
- Confirm re-checks the token (not revoked or expired, still has `create`: 403 otherwise), the role, project/task access and the entry rules. It flips `pending -> confirmed` and inserts the entry in one transaction, so a double click or concurrent confirms create one entry; a repeated confirm returns 200 with the same `entryId`. Cancelled or expired operations return 409.
- The entry audit row has the confirming user as actor and `integrationTokenId`, `integrationTokenName` and `operationId` in `changesJson`. Cancel writes an `IntegrationOperation` / `cancel` audit row.

### Integration corrections (correct with confirmation)

The `correct` scope, separate from `create`, prepares a `correct_entry` operation for one of the caller's own entries. It follows the same prepare, confirm, cancel, idempotency and expiry rules as `create_entry`.

- Prepare loads the entry by `entryId` for the token owner only, also for Owner and Admin. Another user's or account's entry, or a deleted one, returns 404; a running timer returns 409. A correction that changes nothing returns 400.
- The rules are those of `PUT /api/time-entries/[id]` on the entry plus the changes: the entry's project still in access, new project and task in the account and access, active project only when the project changes, end after start, at most 24 hours. A task must belong to the resulting project, otherwise 400 asks for `taskId` (`null` clears it).
- Prepare stores `before`, the entry's six previewed fields at that moment. The view returns `before`, `entry` (the result after the changes) and `changedFields`. A re-opened cancelled or expired correction takes a fresh `before`.
- Confirm flips the operation and updates the entry in one transaction. The update matches the entry only while its fields still equal `before` (`updateMany` with those values in `where`), and writes only the fields in `changes`, plus duration and `entry_date` when a time changes. Tags and other fields stay as they are. The comparison is by value, not `updatedAt`, because a tag-only change bumps `updatedAt` without touching what the preview showed.
- If the entry changed after the preview, nothing is written and confirm returns 409 `{ code: "entry_changed", operation }`. The operation stays `pending` with `before` refreshed and a new 15-minute expiry, and the page shows the new before/after to confirm again. A deleted entry or one that became a running timer returns 409 without refreshing.
- The audit row is `TimeEntry` / `update` with the confirming user as actor and `before`, `after`, `integrationTokenId`, `integrationTokenName` and `operationId` in `changesJson`, like an edit in the app.

### Report round-up

`roundUp=true` rounds each entry up to 10 minutes (minimum 10) before summing, on the Summary, Detailed and shared reports and on the Reports page. Summary totals with round-up sum the rounded entries before fixing to two decimals, like the Reports page KPI cards.

## 3. Resource Conventions

- Base path: `/api/{resource}`
- Naming: plural nouns, kebab-case where relevant
- Filtering: query params per field
- Pagination: page/pageSize or cursor where needed
- Errors: structured JSON, ideally Problem Details style for user-facing failures

## 4. Core Resource Areas

| Area | Representative Paths |
| --- | --- |
| Auth | `/api/auth/*` |
| Time entries | `/api/time-entries*` |
| Projects | `/api/projects*` |
| Tasks | `/api/projects/[projectId]/tasks*` |
| Clients | `/api/clients*` |
| Tags | `/api/tags*` |
| Reports | `/api/reports*`, `/api/public/reports/*` |
| Team/settings/audit | `/api/team*`, `/api/account*`, `/api/audit-logs*` |
| Integrations (Bearer token) | `/api/integrations/v1/*` |

## 5. Contract Guidance

- Route Handlers should validate inputs close to the edge.
- Response shapes should stay stable across frontend usage and tests.
- Multi-tenant behavior must always scope reads and writes to the current account.

## 6. Contract Categories

| Category | Typical Behavior |
| --- | --- |
| CRUD endpoints | Validate input, scope by account, return stable JSON shapes |
| Derived-data endpoints | Aggregate per-account results and keep filters explicit |
| Public share endpoints | Limit access to the intended public payload only |
| Admin endpoints | Enforce owner/admin authorization before data access |

## 7. Related Documents

- [01-architecture.md](01-architecture.md) — Runtime boundaries
- [02-database.md](02-database.md) — Persistence model
- [04-frontend.md](04-frontend.md) — Frontend consumption patterns
- [09-testing.md](09-testing.md) — Route Handler testing requirements
