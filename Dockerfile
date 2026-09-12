# One container running the API and, optionally, the built PWA alongside it.
# Everything the app needs is here: no database server, no queue, no broker.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install with dev dependencies present, because the build needs TypeScript.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --include=dev

COPY . .
RUN npm run build

# SQLite lives here. Mount a volume at /app/data or the ledger resets on deploy.
ENV DATABASE_PATH=/app/data/solder.db
# Serve the PWA from here too, so this one service is the whole app.
ENV SERVE_WEB=1
# PORT is left to the host to inject; the app falls back to 8787 on its own.
EXPOSE 8787

# tsx runs the TypeScript directly; there is no separate compile step to keep
# in sync with what the tests exercise.
CMD ["npx", "tsx", "--no-warnings=ExperimentalWarning", "apps/api/src/main.ts"]
