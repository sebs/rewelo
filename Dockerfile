FROM node:22-slim

ARG APP_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r rw && useradd -r -g rw -d /app -s /sbin/nologin rw

WORKDIR /app

# Install production deps only (gets correct native duckdb for container arch)
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Copy source and build inside container (bakes version at build time)
COPY scripts/ scripts/
COPY src/ src/
COPY tsconfig.json ./
RUN --mount=type=cache,target=/root/.npm npm install --include=dev \
    && APP_VERSION=${APP_VERSION:-$(node -p "require('./package.json').version")} \
       node scripts/inject-version.mjs \
    && npx tsc \
    && npm prune --omit=dev

COPY db/ db/

# Create data directory for database persistence
RUN mkdir -p /data && chown rw:rw /data

# Environment
ENV RW_DB_PATH=/data/relative-weight.duckdb
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=192"

# OCI image label
LABEL org.opencontainers.image.version="${APP_VERSION}"

# Drop privileges
USER rw

# Default: CLI mode
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--help"]

# Volume for database persistence
VOLUME ["/data"]
