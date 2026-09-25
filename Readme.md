# Rewelo

> **Warning:** This is experimental software. It comes without support and is not intended for production use.

A prioritization tool that uses the **relative weight** method to rank stories and tickets by different criteria. Built on SQLite (Node's built-in `node:sqlite`) for embedded, zero-dependency data storage, exposed through a CLI or as a Docker-based MCP server.

* [Website and docs](https://sebs.github.io/rewelo/)
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
  +-- ticket_deletions     (deleted tickets, for project diff)
  +-- weight_configs       (per-project B/P/E/R weights)
```

## Tech Stack

- **SQLite** -- embedded database via Node's built-in `node:sqlite`, no server and no native modules required
- **TypeScript** -- CLI application and business logic
- **Commander.js** -- command-line interface
- **Docker** -- containerized deployment, also usable as an MCP server

## CLI Commands

```
rw project create|list|delete|history|diff
                                    Manage projects, view history and changes
rw ticket  create|list|update|upsert|delete|history
                                    Manage tickets and view revision history
rw tag     create|assign|remove|delete|list|rename|log
                                    Manage tags and view audit log
rw relation create|remove|list|list-all
                                    Ticket relations (blocks, depends-on, relates-to)
rw config  weights                  View/set/reset per-project B/P/E/R weights
rw calc    weights|priority         Relative weights and weighted priority calculations
rw export  csv|json                 Export project data
rw import  csv|json                 Import project data
rw report  summary|group|distribution|health|times|dashboard|event-log
                                    Reporting, HTML dashboard and event stream
rw serve                            Start MCP server (stdio transport)
```

Global options: `--db <path>`, `--json`, `--csv`, `--quiet` (and `--no-color`, accepted for compatibility: `rw` never prints colour)

## Multi-Project Support

The tool is designed around projects as the top-level boundary. Tags, tickets, and all calculations are scoped to a project, so multiple teams or products can use the same instance independently.

## Releasing a New Version

Four GitHub Actions workflows in `.github/workflows/` cover building, releasing and publishing:

| Workflow      | Runs on                   | Does |
|---------------|---------------------------|------|
| `ci.yml`      | pushes and pull requests to `main` | Type check, build, test, and a smoke test of the Docker image |
| `release.yml` | pushing a `v*` tag        | Checks the tag matches `package.json`, tests, and creates the GitHub release with the npm tarball, SBOM, OCI image and changelog; pushes the image to `ghcr.io/sebs/rewelo` |
| `publish.yml` | manual (with a version)   | Publishes that tagged version to npm via trusted publishing, with provenance, then lists it in the MCP Registry as `io.github.sebs/rewelo` |
| `pages.yml`   | pushes to `main`          | Builds the website from `site/` and the docs, and deploys it to GitHub Pages |

To release:

1. Bump the version, which commits it (with `server.json`, the MCP Registry entry, set to the same version) and creates the matching tag:

```bash
npm version patch   # 0.1.0 → 0.1.1 (or minor, major)
```

2. Push the commit and the tag; `release.yml` builds the release:

```bash
git push --follow-tags
```

3. Publish to npm: run the Publish workflow with the new version (Actions → Publish → Run workflow), or `gh workflow run publish.yml -f version=0.1.1`. Once npm shows the version, the workflow lists it in the [MCP Registry](https://registry.modelcontextprotocol.io) too (mcp-publisher, logged in with the workflow's GitHub OIDC token, so without a secret). Prereleases such as `0.2.0-beta.1` are published under the `next` dist-tag, and a backport older than the current latest (0.5.2 after 0.6.1) under `backport`, so `npm install rewelo` keeps getting the newest stable version.

One-time setup: add `sebs/rewelo` with workflow `publish.yml` as a trusted publisher of the `rewelo` package on npmjs.com, and set Settings → Pages → Source to "GitHub Actions".

To run the released image:

```bash
# CLI
docker run --rm -v rw-data:/data ghcr.io/sebs/rewelo:latest project list

# MCP server
docker run --rm -i -v rw-data:/data ghcr.io/sebs/rewelo:latest serve
```

Use a named volume (`rw-data`) or a bind mount to persist the database across container restarts. Without one, the database stays inside the container and is lost when it is removed (with `--read-only` it can't be written at all); rw warns about this on stderr.

## MCP Server

The CLI doubles as an MCP server over stdio, letting AI assistants manage projects, tickets, tags, and calculations directly. See [mcp.md](mcp.md) for client configuration, available tools, and troubleshooting.

## Examples

See [examples.md](examples.md) for step-by-step scenarios, each as a copy-pasteable Claude Code prompt (MCP) and as `rw` commands with their output: CSV import, dependency mapping, custom weights, quick wins, tracking work, scripting, and sharing and backing up a backlog.
