# TempoBase App

This package contains the full-stack TempoBase application.

## Runtime Role

- UI runtime: Next.js App Router
- Active backend surface: Route Handlers under `src/app/api`
- Persistence integration: Prisma
- Target auth model: Auth.js session cookies

## Local Development

```bash
pnpm install
pnpm dev
```

The app runs on `http://localhost:3000` by default.

## Common Commands

```bash
pnpm dev
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm exec prisma generate
pnpm exec prisma migrate deploy
```

## Environment Notes

Typical local variables include:

- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_API_URL`

See [../DEPLOYMENT.md](../DEPLOYMENT.md) and [../docs/06-infrastructure.md](../docs/06-infrastructure.md) for deployment-oriented details.

## Testing Expectations

- Use Vitest for units, hooks, and component tests.
- Use integration-style tests for Route Handler plus Prisma behavior.
- Use Playwright for important end-to-end flows.
- Keep product behavior covered at the lowest effective test level.
