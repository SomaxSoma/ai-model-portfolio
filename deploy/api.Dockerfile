# syntax=docker/dockerfile:1.7
# API + worker image. One image, two commands:
#   node apps/api/dist/server.js   (stateless HTTP API)
#   node apps/api/dist/worker.js   (scheduled ingestion via the Redis queue)

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/design-system/package.json packages/design-system/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run build -w @pf/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/design-system/package.json packages/design-system/
# Production dependencies of the API workspace only (includes @pf/domain's decimal.js).
RUN npm ci --omit=dev --workspace=@pf/api --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY data data
USER node
EXPOSE 3001
ENV HOST=0.0.0.0 PORT=3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "apps/api/dist/server.js"]
