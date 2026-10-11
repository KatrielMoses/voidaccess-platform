# syntax=docker/dockerfile:1
# Build from the MONOREPO ROOT:
#   docker build -f apps/app/Dockerfile -t va-app .
# Runs the Next.js standalone server on $PORT (Cloud Run injects PORT=8080).

ARG NODE_IMAGE=node:24-slim

# ---- deps + build -----------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV NEXT_TELEMETRY_DISABLED=1 CI=1
RUN npm install -g pnpm@10.34.5
WORKDIR /repo

# Whole repo (see apps/app/Dockerfile.dockerignore); pnpm needs every workspace manifest.
COPY . .
RUN pnpm install --frozen-lockfile --filter @voidaccess/app...
# No secrets needed at build: env.ts validates lazily and /api/health is dynamic.
RUN pnpm --filter @voidaccess/app build

# ---- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
ARG APP_VERSION=0.0.0
ARG COMMIT_SHA=unknown
ENV APP_VERSION=${APP_VERSION} COMMIT_SHA=${COMMIT_SHA}
WORKDIR /repo

# outputFileTracingRoot = monorepo root, so the server lives at apps/app/server.js
COPY --from=build --chown=node:node /repo/apps/app/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/app/.next/static ./apps/app/.next/static
COPY --from=build --chown=node:node /repo/apps/app/public ./apps/app/public

USER node
EXPOSE 8080
CMD ["node", "apps/app/server.js"]
