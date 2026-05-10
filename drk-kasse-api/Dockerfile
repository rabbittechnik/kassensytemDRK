# Nur Backend (kein SPA). Full-Stack mit /health + /api + statische UI: ../Dockerfile im Monorepo-Wurzelverzeichnis nutzen.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_ROOT=/DATA

EXPOSE 8787

CMD ["npm", "run", "start"]
