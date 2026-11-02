# TempoBase — Business Rules

> Product rules and permission constraints.

## 1. Domain Language

| Term | Definition |
| --- | --- |
| Account | Top-level tenant boundary for all workspace data |
| User | A person who belongs to exactly one account |
| Client | External organization a project is performed for |
| Project | A body of work under a client |
| Task | A task within a project |
| TimeEntry | A record of worked time |
| Tag | A label attached to time entries |
| Tracker | The live timer interface |
| Timesheet | The weekly bulk-entry interface |
| Report | A derived view of time and billing data |

## 2. Roles

| Role | Scope |
| --- | --- |
| Owner | Full access including account-destructive actions |
| Admin | Operational management without owner-only destructive powers |
| Manager | Team visibility and project/report management |
| Member | Own time tracking and own report usage |
| Viewer | Read-only access where allowed |

## 3. Core Workflows

### Account onboarding

1. A user registers an account.
2. The first user becomes the account Owner.
3. Owners and Admins can invite additional users.
4. Invitees join the account with the assigned role.

### Timer tracking

1. User enters description and selects project, task, and tags as needed.
2. User starts a timer, creating a running entry.
3. Only one running timer is allowed per user.
4. User stops the timer and duration is finalized.

### Stale timer recovery

1. While the tracker is open, polling `GET /api/time-entries/running` records a heartbeat in `time_entries.last_seen_at`.
2. When that poll finds a heartbeat older than 5 minutes, the app was away in between: the old heartbeat is copied to `time_entries.last_session_end_at`, which is the recovery point. It stays put while the app keeps polling and only moves when a new gap appears, so the moment the timer was forgotten is not overwritten by the current session.
3. Closing the window with a timer running triggers the browser's own generic unload warning. It cannot be customized, and it does not fire on crashes, force-quit, or OS shutdown.
4. On opening the app, a running timer that started on an earlier calendar day (user's local time) prompts for recovery: stop it at the end of the previous session, keep it running, or discard the timer.
5. Choosing to keep it running suppresses the prompt for that entry only.
6. `POST /api/time-entries/stop` accepts an optional `endTime` for this flow; it must be after the start time and not in the future.

### Manual entry

1. User selects a date and provides a time range or duration.
2. User adds project/task/tag context.
3. The entry is stored as a completed time entry.

### Reporting

1. User selects a date range and filters.
2. The system produces summary, detailed, or weekly views.
3. Reports may be exported or shared when the user has permission.

### CSV import

1. User uploads a supported CSV export.
2. The system validates and maps rows.
3. The user confirms the import.
4. Duplicate rows are skipped according to the active duplicate-detection rules.

## 4. Entity Rules

### Account

- Required: `name`, `slug`.
- Every tenant-scoped record must belong to exactly one account.
- Only an Owner can delete the account.
- The account must always have at least one Owner.

### User

- Required: `email`, profile name fields, and password hash.
- Email is unique per account and treated case-insensitively.
- A user belongs to exactly one account.
- A user has exactly one active role within the account.
- Deactivated users retain historical data but cannot authenticate.

### Client

- Required: `name` unique within the account.
- Archived clients should remain visible in historical references and reports.

### Project

- Required: `name` unique within the account.
- Project billing defaults may influence new time entries.
- A project is Active, Inactive, or Archived.
- Only Active projects accept new time. The API enforces this for manual entries, timers, imports, and entries moved to another project.
- Inactive means ready but not in use yet, such as a project prepared for the next cycle.
- Archived means finished or discontinued.
- Inactive and Archived projects are hidden from normal selection but preserved historically. Their existing entries stay editable.
- Duplicating a project copies its data, tasks, and member access, but not its time entries. The copy starts Inactive.

### Task

- Required: `name` unique within its project.
- Task-level billing settings may override project defaults where supported.

### TimeEntry

- Required: owning user and a valid start context.
- A running entry has no completed end timestamp yet.
- A completed entry must satisfy `end >= start`.
- A single user cannot have more than one running timer.
- A single entry cannot exceed 24 hours.
- Billable state defaults from project/task settings when applicable and may be overridden.

### Tag

- Tag names are unique within an account.
- Tags are many-to-many with time entries.

### AuditLog

- Audit records are immutable.
- Audit visibility is restricted to the roles allowed by the product.
- Audit records must remain tenant-isolated.

## 5. Permissions Matrix

| Resource | Action | Owner | Admin | Manager | Member | Viewer |
| --- | --- | --- | --- | --- | --- | --- |
| Account | Update | Yes | No | No | No | No |
| Account | Delete | Yes | No | No | No | No |
| User | Invite | Yes | Yes | No | No | No |
| User | Change role | Yes | Yes | No | No | No |
| User | Toggle canViewAmounts | Yes | Yes | No | No | No |
| User | Deactivate | Yes | Yes | No | No | No |
| Client | Create/Edit | Yes | Yes | Yes | No | No |
| Project | Create/Edit | Yes | Yes | Yes | No | No |
| Task | Create/Edit | Yes | Yes | Yes | No | No |
| Tag | Create/Edit | Yes | Yes | Yes | Yes | No |
| TimeEntry | Create/Edit own | Yes | Yes | Yes | Yes | No |
| TimeEntry | Edit/Delete others | Yes | Yes | Yes | No | No |
| Report | View own | Yes | Yes | Yes | Yes | Yes |
| Report | View team | Yes | Yes | Yes | No | Yes |
| Report | Share/export | Yes | Yes | Yes | Depends on route | No |
| CSV Import | Execute | Yes | Yes | No | No | No |
| Audit Log | View | Yes | Yes | No | No | No |

## 6. Invariants

- Cross-account data access is never allowed.
- A user can have at most one running timer.
- Completed entries satisfy `end_time >= start_time`.
- Soft-deleted or archived records remain available for historical views where required.
- Default project preferences must reference a project in the same account.

## 7. Calculation Rules

- Duration is derived from start/end timestamps or validated manual input.
- Decimal duration is a derived reporting value.
- Amount is based on duration multiplied by the active rate source when billing is enabled.
- When a user's `canViewAmounts` is `false`, all monetary values (billed amounts, rates) are stripped server-side from report responses and hidden from the UI. This is enforced at the API layer regardless of client state.
- Rounding, when supported, is applied at presentation or export time unless explicitly persisted.

## 8. Related Documents

- [01-architecture.md](01-architecture.md) — Runtime boundaries
- [03-api-design.md](03-api-design.md) — Route Handler contracts
- [09-testing.md](09-testing.md) — Testing expectations
