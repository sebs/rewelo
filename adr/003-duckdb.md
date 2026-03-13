# ADR-003: DuckDB as Database

## Status

Accepted

## Context

The tool needs a relational database for storing tickets, tags, and revision history. The original design used PostgreSQL with stored procedures, requiring a running server (typically via Docker). For a CLI tool this adds friction: users must manage a container or install PostgreSQL locally.

We need a database that:

- Supports SQL with strong analytical capabilities
- Requires zero infrastructure (no server, no Docker for basic usage)
- Embeds directly into the Node.js process
- Stores data in a single portable file
- Handles the dataset sizes we expect (hundreds to low thousands of tickets per project)

## Decision

We use **DuckDB** as the sole database engine.

### Rationale

- **Embedded** -- runs in-process via `duckdb-node`. No server to start, no container to manage. The CLI just works.
- **Single file** -- the entire database is one `.duckdb` file. Easy to back up, move between machines, or check into version control if desired.
- **Full SQL** -- supports schemas, sequences, enums, check constraints, foreign keys, JSON, window functions, and CTEs. Everything we need for the data model.
- **Analytical strength** -- columnar storage and vectorized execution make aggregation queries (relative weights, sums across projects) fast without manual optimisation.
- **No stored procedures** -- business logic lives in TypeScript, which aligns with our testing strategy (ADR-002). SQL stays declarative; application code stays testable.

### Trade-offs

- **No concurrent writers** -- DuckDB supports a single writer at a time. Acceptable for a CLI tool where commands run sequentially.
- **No network protocol** -- there is no client/server mode. If we later need multi-user access, we would need a gateway layer or a different database.
- **Smaller ecosystem** -- fewer extensions and community tooling compared to PostgreSQL. For our use case this is not a limiting factor.

## Consequences

- All SQL must be DuckDB-compatible (no PostgreSQL-specific syntax like `SERIAL`, `DOMAIN`, `COMMENT ON`, `JSONB`).
- The schema uses explicit sequences for auto-increment and inline `CHECK` constraints for Fibonacci validation.
- Business logic and calculations live in TypeScript, not in the database layer.
- Users can inspect their data directly with the `duckdb` CLI if needed.
