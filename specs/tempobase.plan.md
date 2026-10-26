# TempoBase — Product Baseline

TempoBase is a full-stack time tracking product for small teams and client-facing work reporting. The active application lives in `app/` and is deployed as a Next.js app backed by PostgreSQL.

This file is stable product context, not an active task tracker. New work should be tracked in GitHub Issues and linked from PRs.

## Product Purpose

TempoBase helps teams:

- track time by client, project, task, tag, and description,
- manage team access and tenant-scoped data,
- report billable and non-billable work,
- share client-facing reports,
- import time-entry data from CSV,
- audit important account and time-entry activity.

## Runtime And Stack

| Area | Choice |
| --- | --- |
| App runtime | Next.js 16 App Router + React 19 |
| Backend surface | Next.js Route Handlers under `app/src/app/api/` |
| Data access | Prisma 7 + PostgreSQL 16 |
| Auth | Auth.js v5 session cookies |
| UI | ShadCN/ui, Tailwind v4, lucide icons |
| Data fetching | Same-origin `/api`, TanStack Query/Table |
| Forms/validation | React Hook Form + Zod |
| Charts | Recharts |
| Tests | Vitest, Testing Library, Playwright |
| Deployment | Vercel app root `app`, Neon PostgreSQL |
| Local dev | Docker Compose PostgreSQL + `pnpm dev` |

## Core Domain

| Concept | Meaning |
| --- | --- |
| Account | Tenant and data isolation boundary |
| User | Person inside an account |
| Client | External customer or internal work recipient |
| Project | Work container under a client |
| Task | Activity category within a project |
| TimeEntry | Tracked work period with date, duration, description, tags, billing metadata |
| Tag | Cross-project label for categorization |
| Report | Aggregated time data with filters, grouping, charts, export/share options |
| AuditLog | Recorded security, account, and time-entry events |

## Current Product Capabilities

- Authentication and registration with Auth.js credentials.
- Tenant-scoped clients, projects, tasks, tags, and time entries.
- Timer and manual time-entry workflows.
- Dashboard, reports, exports, and shared report links.
- CSV import with persisted import sessions and duplicate protection.
- Billing/rate visibility controls.
- Team management, invites, settings, audit log, and account data operations.
- PWA manifest and installable app icons.

## Engineering Baseline

- Keep tenant scoping explicit with `accountId` filters.
- Keep product rules testable outside UI components when practical.
- Use Route Handlers for backend behavior and same-origin `/api` from the app.
- Preserve light/dark theme support and responsive layouts.
- Use existing local helpers and patterns before introducing new abstractions.
- Apply Prisma schema changes through migrations, never `prisma db push` for deployable changes.

## Quality Gates

Use the smallest honest validation for each change. Common commands from the repository root:

```bash
pnpm prisma:validate
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

If a command needs secrets, a live database, or applies migrations, call out the requirement instead of marking it passed by assumption.

## Work Tracking

GitHub Issues are the official tracker for new bugs, enhancements, hardening work, and documentation tasks.

Use local specs for:

- stable product and architecture context,
- current operating status,
- historical delivery archive.

Do not create new `phaseN.issue.md` files for active work. Archived phase files are historical only.

## Historical Archive

The initial delivery phase files were archived under `specs/archive/phases/` after the product moved from build-out mode to product maintenance mode.
