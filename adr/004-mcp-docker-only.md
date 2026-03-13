# ADR-004: MCP Server Runs Only Inside Docker

## Status

Accepted

## Context

The MCP server exposes all functionality over stdio transport, allowing AI assistants to create projects, manage tickets, and run calculations. During development we considered two deployment modes:

1. **Docker container** -- the server runs inside a container with a named volume for database persistence.
2. **Bare Node process** -- the server runs directly via `node dist/index.js serve`.

Running as a bare Node process works but has drawbacks:

- The database file location depends on the host environment (home directory, working directory, or an environment variable).
- There is no isolation between the MCP server process and the rest of the host system.
- Different machines may have different Node.js versions or native module compatibility issues (especially `duckdb-node`).

## Decision

The MCP server **must** run inside a Docker container. Running it as a bare Node process is not supported.

### Rationale

- **Consistent environment** -- the container pins Node.js 22, installs the correct native DuckDB bindings for the container architecture, and sets `RW_DB_PATH=/data/relative-weight.duckdb`. No host-specific configuration needed.
- **Data isolation** -- the database lives in a named Docker volume (`rw-data`). It persists across container restarts but is separate from the host filesystem.
- **Security** -- the container runs as a non-root user (`rw`). The MCP client (Claude Desktop, Claude Code) manages the container lifecycle: start on connect, stop on disconnect.
- **Reproducibility** -- `docker build -t rewelo-mcp .` produces the same image everywhere. No "works on my machine" problems with native modules.

### Trade-offs

- **Docker required** -- users and MCP clients must have Docker installed and running. This adds a prerequisite compared to a bare `node` invocation.
- **Startup latency** -- container startup adds a small delay compared to running node directly. Acceptable for a long-lived stdio server.
- **Development friction** -- developers must rebuild the image after changes (`npx tsc && docker build -t rewelo-mcp .`). For local development, tests run outside Docker via `vitest`.

## Consequences

- The `.mcp.json` configuration uses `docker run` commands, not `node` commands.
- The `mcp.md` documentation describes Docker as the only supported way to run the MCP server.
- The Dockerfile is a first-class artifact that must be maintained alongside the source code.
- Local development and testing continue to use `node` and `vitest` directly -- Docker is only required for the MCP server runtime.
