# syntax=docker/dockerfile:1
# Single image: Express API + static frontend. SQLite lives on a volume at /data.

FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/scanner.db
WORKDIR /app
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/
COPY backend/src ./backend/src
COPY backend/data ./backend/data
COPY backend/scripts ./backend/scripts
# frontend/css/tailwind.css is prebuilt and committed (npm run build:css)
COPY frontend ./frontend
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
WORKDIR /app/backend
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
