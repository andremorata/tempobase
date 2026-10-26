# Build (install + build in one stage to preserve pnpm virtual store symlinks)
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_API_URL=/api
ARG DATABASE_URL=postgresql://postgres:localdev@localhost:5432/tempobase
ARG DIRECT_DATABASE_URL=postgresql://postgres:localdev@localhost:5432/tempobase
ARG NEXTAUTH_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV DATABASE_URL=$DATABASE_URL
ENV DIRECT_DATABASE_URL=$DIRECT_DATABASE_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
RUN pnpm build

# Runtime
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Install prisma CLI for schema push on startup
RUN npm install -g prisma@7 --no-fund --no-audit --quiet

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Prisma schema is needed at runtime for db push
COPY --from=build /app/prisma ./prisma

# Entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

# Run as non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["sh", "/docker-entrypoint.sh"]
