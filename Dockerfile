# ---- builder: install once, build, prune ----
FROM node:26-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY scripts/ scripts/
COPY src/ src/
COPY tsconfig.json ./

ARG APP_VERSION
RUN APP_VERSION=${APP_VERSION:-$(node -p "require('./package.json').version")} \
       node scripts/inject-version.mjs \
    && npx tsc \
    && npm prune --omit=dev

# ---- runtime: copy only what's needed ----
FROM node:26-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r rw && useradd -r -g rw -d /app -s /sbin/nologin rw

WORKDIR /app

COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/package.json ./
COPY db/ db/

# Create data directory for database persistence
RUN mkdir -p /data && chown rw:rw /data

# Environment
ENV RW_DB_PATH=/data/relative-weight.db
# Large transactions spill to temporary files; with --read-only the default
# temp directory is not writable, so keep them on the data volume
ENV SQLITE_TMPDIR=/data
ENV NODE_ENV=production
# Heap below the documented 256 MB container limit (mcp.md), leaving room for
# SQLite and buffers: with 512 the kernel killed the process before the heap
# limit was ever reached. Imports up to the 50 MB limit fit.
ENV NODE_OPTIONS="--max-old-space-size=192"

# OCI image label
ARG APP_VERSION
LABEL org.opencontainers.image.version="${APP_VERSION}"

# Drop privileges
USER rw

# Default: CLI mode
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]

# Volume for database persistence
VOLUME ["/data"]
