# syntax=docker/dockerfile:1.7
# PairUp Phase 1 single-container — Fastify serves /api/* + the built frontend.
# Build context: monorepo root.
#
# Stages:
#   deps    npm install (dev deps included so frontend esbuild can run).
#   build   tsc on @pairup/matching, then on @pairup/web; esbuild the frontend
#           into apps/web/public/.
#   runtime node:20-alpine; production deps only; non-root; port 8080.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json        ./apps/web/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/matching/package.json ./packages/matching/
RUN npm ci --workspaces --include-workspace-root

FROM node:20-alpine AS build
WORKDIR /app
# npm workspaces hoist all deps into the root node_modules — no per-workspace
# node_modules folders are created by npm 7+, so a single copy is enough.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY apps/web        ./apps/web
COPY packages        ./packages
COPY migrations      ./migrations
RUN npm --workspace @pairup/matching run build \
 && npm --workspace @pairup/frontend run build \
 && npm --workspace @pairup/web      run build

FROM node:20-alpine AS prune
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json* ./
COPY --from=build /app/apps/web/package.json        ./apps/web/
COPY --from=build /app/packages/frontend/package.json ./packages/frontend/
COPY --from=build /app/packages/matching/package.json ./packages/matching/
RUN npm ci --workspaces --include-workspace-root --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
RUN apk add --no-cache tini
# Production-only node_modules from the prune stage.
COPY --from=prune /app/node_modules                   ./node_modules
# Built artefacts from the build stage.
COPY --from=build /app/apps/web/dist                  ./apps/web/dist
COPY --from=build /app/apps/web/public                ./apps/web/public
COPY --from=build /app/apps/web/package.json          ./apps/web/package.json
COPY --from=build /app/packages/matching/dist         ./packages/matching/dist
COPY --from=build /app/packages/matching/package.json ./packages/matching/package.json
COPY --from=build /app/packages/frontend/package.json ./packages/frontend/package.json
COPY --from=build /app/migrations                     ./migrations
COPY --from=build /app/package.json                   ./package.json

EXPOSE 8080
USER node

# tini → node so SIGTERM from Container Apps reaches the Fastify shutdown
# hook cleanly.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/dist/index.js"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/api/health >/dev/null 2>&1 || exit 1
