# Monorepo-Image: Fastify-API + Vite-SPA eine Origin (Health/API vor SPA-Fallback).
# Railway: Root Directory = dieses Repo-Verzeichnis, Dockerfile = Dockerfile.
# Env: JWT_SECRET (u. a. siehe drk-kasse-api loadEnv); API_MOUNT_PATH=/api empfohlen.
# Optional Build-Arg: VITE_API_BASE_URL (Default /api, gleiche Origin).

# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend
WORKDIR /fe
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY package.json package-lock.json ./
RUN npm ci
COPY eslint.config.js index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:22-bookworm-slim AS api-builder
WORKDIR /app
COPY drk-kasse-api/package.json drk-kasse-api/package-lock.json ./
RUN npm ci
COPY drk-kasse-api/tsconfig.json ./
COPY drk-kasse-api/src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_ROOT=/DATA
ENV API_MOUNT_PATH=/api
ENV SPA_ROOT=/app/public

COPY --from=api-builder /app/package.json /app/package-lock.json ./
COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/dist ./dist
COPY --from=frontend /fe/dist ./public

EXPOSE 8787
CMD ["node", "dist/index.js"]
