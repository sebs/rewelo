# Rewelo

> **Warning:** This is experimental software. It comes without support and is not intended for production use.

A prioritization tool that uses the **relative weight** method to rank stories and tickets by different criteria. Built on DuckDB for embedded, zero-dependency data storage, exposed through a CLI or as a Docker-based MCP server.

* [Blogpost](https://dev.to/sebs/i-was-so-angry-i-actually-shipped-it-2m19)
* [Initial Idea](https://dev.to/sebs/i-was-so-angry-i-built-my-own-4mj1)


## How It Works

Each ticket is scored on four dimensions using the agile Fibonacci scale (1, 2, 3, 5, 8, 13, 21):

| Dimension    | Measures                                      |
|--------------|-----------------------------------------------|
| **Benefit**  | Value gained by implementing the story        |
| **Penalty**  | Cost of *not* implementing the story          |
| **Estimate** | Resources required for implementation         |
| **Risk**     | Uncertainty or complexity in implementation   |

From these, the tool calculates priority at runtime:

```
Value    = Benefit + Penalty
Cost     = Estimate + Risk
Priority = Value / Cost
```

Higher priority means better return on investment. Relative weights normalize scores across the full backlog or within a tagged subset (e.g. a feature). See [calculations.md](calculations.md) for the full specification.

## Tags

Tickets are organized through a flexible **tag system** using `prefix:value` pairs. Tags replace fixed fields for state, feature grouping, and any other classification:

- `state:backlog`, `state:wip`, `state:done`
- `feature:checkout`, `feature:auth`
- `team:platform`, `priority:critical`

Every tag assignment and removal on a ticket is tracked in an audit log, enabling lead time and cycle time calculations from `state:` tag transitions.

## Revision History

The tool maintains full revision history at two levels:

- **Ticket revisions** -- snapshots of content (title, description, scores) and tags before each change
- **Tag revisions** -- snapshots of tag definitions (prefix, value) before renames or edits

This means you can reconstruct the exact state of any ticket at any point in time.

## Data Model

The database schema is defined in [db/create.sql](db/create.sql) and documented as DBML in [db/model.dbml](db/model.dbml).

```
projects
  +-- tickets              (B, P, E, R scores)
  |     +-- ticket_revisions     (content + tag snapshots)
  +-- tags                 (prefix:value pairs)
  |     +-- tag_revisions
  +-- ticket_tags          (current assignments)
  +-- ticket_tag_changes   (audit log: added/removed)
  +-- ticket_relations     (blocks, depends-on, relates-to)
  +-- weight_configs       (per-project B/P/E/R weights)
```

## Tech Stack

- **DuckDB** -- embedded analytical database, no server required
- **TypeScript** -- CLI application and business logic
- **Commander.js** -- command-line interface
- **Docker** -- containerized deployment, also usable as an MCP server

## CLI Commands

```
rw project create|list|delete       Manage projects
rw ticket  create|list|update|delete|history
                                    Manage tickets and view revision history
rw tag     create|assign|remove|list|rename|log
                                    Manage tags and view audit log
rw relation create|remove|list      Ticket relations (blocks, depends-on, relates-to)
rw config  weights                  View/set/reset per-project B/P/E/R weights
rw calc    weights|priority         Relative weights and weighted priority calculations
rw export  csv|json                 Export project data
rw import  csv|json                 Import project data
rw report  summary|group|distribution|health|times|dashboard
                                    Reporting and HTML dashboard generation
rw serve                            Start MCP server (stdio transport)
```

Global options: `--db <path>`, `--json`, `--csv`, `--quiet`, `--no-color`

## Multi-Project Support

The tool is designed around projects as the top-level boundary. Tags, tickets, and all calculations are scoped to a project, so multiple teams or products can use the same instance independently.

## Releasing a New Version

1. Bump the version in `package.json`:

```bash
npm version patch   # 0.1.0 → 0.1.1
# or
npm version minor   # 0.1.0 → 0.2.0
# or
npm version major   # 0.1.0 → 1.0.0
```

2. Build and tag the Docker image:

```bash
VERSION=$(node -p "require('./package.json').version")
docker build --build-arg APP_VERSION=$VERSION -t rewelo-mcp:$VERSION -t rewelo-mcp:latest .
```

3. Run the latest container:

```bash
# CLI
docker run --rm -v rw-data:/data rewelo-mcp:latest project list

# MCP server
docker run --rm -i -v rw-data:/data rewelo-mcp:latest serve
```

Use a named volume (`rw-data`) or a bind mount to persist the database across container restarts.

## MCP Server

The CLI doubles as an MCP server over stdio, letting AI assistants manage projects, tickets, tags, and calculations directly. See [mcp.md](mcp.md) for client configuration, available tools, and troubleshooting.

## Examples

See [examples.md](examples.md) for step-by-step usage examples with copy-pasteable prompts for Claude Code, covering CSV import, dependency mapping, and priority calculation with custom weights.
