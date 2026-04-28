# syntax=docker/dockerfile:1.7
# Build context: monorepo root.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/matching/package.json ./packages/matching/
RUN npm install --workspaces --include-workspace-root --omit=dev

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/matching/package.json ./packages/matching/
RUN npm install --workspaces --include-workspace-root
COPY apps/web ./apps/web
COPY packages ./packages
RUN npm --workspace @pairup/web run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY apps/web/package.json ./apps/web/package.json
EXPOSE 8080
USER node
WORKDIR /app/apps/web
CMD ["node", "dist/index.js"]
