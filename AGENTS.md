# TempoBase — Agent Instructions

TempoBase is a production-ready, full-stack time tracking application. It uses Next.js App Router for UI and backend Route Handlers, Prisma for PostgreSQL access, Auth.js for authentication, and Vercel + Neon for deployment.

These instructions are for AI agents working in this repository. Keep changes focused, verified, and aligned with the existing product.

## Project Map

- `app/` — full-stack Next.js application.
- `app/src/app/(app)/` — authenticated product pages.
- `app/src/app/(auth)/` — login and registration pages.
- `app/src/app/api/` — backend Route Handlers.
- `app/src/components/` — UI components.
- `app/src/lib/` — API clients, auth helpers, Prisma/db modules, reporting logic, utilities.
- `app/prisma/` — Prisma schema, seed script, and migrations.
- `app/e2e/` — Playwright tests.
- `docs/` — architecture, database, API, frontend, infra, testing, and workflow docs.
- `specs/` — stable product baseline, current status, and historical delivery archive.

`AGENTS.md` is the authoritative instruction file. `CLAUDE.md` and `.github/copilot-instructions.md` should point to it; do not maintain separate copies.

## Core Rules

- Treat this as the TempoBase product, not a starter template.
- Prefer existing patterns in `app/src/` over new abstractions.
- Keep UI behavior, Route Handler contracts, Prisma access, and tests consistent with the docs.
- Do not introduce legacy backend, Azure infra, or pre-rename path assumptions.
- Do not change unrelated files or rewrite historical records unless asked.
- Never revert user changes unless explicitly instructed.

## Before Substantial Work

Read only the context needed for the task, but include these when the change is non-trivial:

1. `specs/tempobase.plan.md`
2. `specs/progress.status.md`
3. The GitHub Issue or PR context when the work is issue-driven.
4. Related docs under `docs/`

Archived phase files under `specs/archive/` are historical only. Do not use them as active scope or acceptance criteria.

If specs, GitHub Issues, and the user's request conflict, follow the user's current instruction and call out the mismatch.

## Implementation Guidance

- UI and workflows belong in `app/src/app/`, `app/src/components/`, hooks, and supporting `app/src/lib/` modules.
- Backend behavior belongs in `app/src/app/api/` Route Handlers.
- Business rules should stay testable outside UI components when practical.
- Keep tenant isolation explicit through `accountId` scoping.
- Use Auth.js session cookies as the auth model.
- Prefer same-origin `/api` calls from the app.
- Use ShadCN/ui, Tailwind v4, lucide icons, TanStack Query/Table, React Hook Form, Zod, Recharts, and existing local helpers where they already fit.
- Preserve light/dark theme support and responsive behavior.

## Database And Migrations

This project uses Prisma Migrate for deployable schema changes.

When changing `app/prisma/schema.prisma`:

1. Create a new migration:
   ```bash
   cd app
   pnpm exec prisma migrate dev --name short_description_of_change
   ```
2. Commit the schema change and generated migration together.
3. Never use `prisma db push` as a substitute for a production migration.

Rules:

- Never edit or delete existing applied migrations.
- Use short lowercase migration names, e.g. `add_invoice_table`.
- Call out destructive schema changes clearly.
- Keep the build script order intact: `prisma generate`, then `prisma migrate deploy`, then `next build`. The migrate step is skipped when `VERCEL_ENV=preview`.

## Validation Commands

Run the smallest honest validation for the change. Common commands:

```bash
pnpm prisma:validate
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

For focused work, run targeted tests first, then broader checks when the touched surface justifies it. If a command requires secrets or a live database, mark it blocked instead of pretending it passed.

## Documentation And Specs

- Update docs when behavior, architecture, deployment, validation, or workflow changes.
- Update `specs/progress.status.md` when status, evidence, risks, or next actions change.
- Track active work in GitHub Issues, not new local `phaseN.issue.md` files.
- Do not rewrite archived phase files or old validation evidence unless explicitly asked.

## Deployment Notes

- Production target: Vercel + Neon PostgreSQL.
- Local baseline: Docker Compose PostgreSQL plus the Next.js app in `app/`.
- Vercel Root Directory must be `app`.
- The production build runs Prisma generation, migration deployment, and Next.js build.

## Safety

- Do not print secrets from `.env*` files.
- Do not run destructive database commands without explicit approval.
- Do not post to GitHub, open reviews, merge PRs, or make public comments unless the user explicitly asks.
- Prefer reversible, narrow edits and explain remaining risks when validation is incomplete.
