# MCP Server

Rewelo exposes all functionality as an MCP (Model Context Protocol) server over stdio transport. This lets AI assistants like Claude create projects, manage tickets, assign tags, and calculate priorities directly.

Run it from the published Docker image, as configured below (recommended: it runs with dropped capabilities, a read-only filesystem and a memory limit), or with `rw serve` from the npm package (see [Without Docker](#without-docker)).

## Prerequisites

Pull the image once (each release publishes `ghcr.io/sebs/rewelo:<version>` and, for the newest release, `:latest`):

```bash
docker pull ghcr.io/sebs/rewelo:latest
```

To run a local build instead, build it from a checkout and use `rewelo-mcp` in place of `ghcr.io/sebs/rewelo` below:

```bash
docker build --build-arg APP_VERSION="$(node -p "require('./package.json').version")" -t rewelo-mcp .
```

The database is stored inside the container volume at `/data/relative-weight.db` and persists across restarts via the `rw-data` named volume.

## Client Configuration

The MCP client (Claude Desktop, Claude Code, etc.) manages the container lifecycle automatically — it starts the container when needed and stops it when done.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rewelo": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--init", "--cap-drop=ALL", "--read-only", "--tmpfs", "/tmp", "--memory=256m", "-v", "rw-data:/data", "ghcr.io/sebs/rewelo", "serve"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root, or register it for all your projects with `claude mcp add --scope user rewelo -- docker run --rm -i --init --cap-drop=ALL --read-only --tmpfs /tmp --memory=256m -v rw-data:/data ghcr.io/sebs/rewelo serve`. The project file looks like this:

```json
{
  "mcpServers": {
    "rewelo": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "--init", "--cap-drop=ALL", "--read-only", "--tmpfs", "/tmp", "--memory=256m", "-v", "rw-data:/data", "ghcr.io/sebs/rewelo", "serve"]
    }
  }
}
```

### What this does

- `--rm` cleans up the container on exit
- `--init` ensures signals (Ctrl+C, SIGTERM) are forwarded correctly
- each client session gets its own container (no fixed `--name`), so a second session, e.g. Claude Desktop and Claude Code at once, doesn't stop the first; they share the database in the `rw-data` volume
- `-v rw-data:/data` persists the database across container restarts
- `-i` keeps stdin open for stdio transport
- `--cap-drop=ALL` drops all Linux capabilities for minimal attack surface
- `--read-only` makes the root filesystem read-only (only `/data` is writable)
- `--tmpfs /tmp` provides a writable temp directory in memory
- `--memory=256m` limits container memory to 256 MB

### Without Docker

With the npm package installed (`npm install -g rewelo`), a client can start `rw serve` directly. Set `RW_DB_PATH` to keep the database in a fixed place; otherwise it is `relative-weight.db` in the client's working directory:

```json
{
  "mcpServers": {
    "rewelo": {
      "command": "rw",
      "args": ["serve"],
      "env": { "RW_DB_PATH": "/Users/you/rewelo/backlog.db" }
    }
  }
}
```

## Verifying the Server

Use the MCP inspector to browse tools and test them interactively:

```bash
npx @modelcontextprotocol/inspector docker run --rm -i --init -v rw-data:/data ghcr.io/sebs/rewelo serve
```

## Available Tools

`project` is optional everywhere it appears: without it, a tool uses the `"project"` field of the nearest `.rewelo.json`, looked up from the server's working directory upwards (for example `{"project": "Acme"}`). In the Docker setup above that directory is `/app` inside the container, where there is none: use `rw serve` [without Docker](#without-docker), started in the project's directory, or pass `project`. The server's instructions (sent on connecting) say which default project, if any, it found. A `?` marks optional parameters.

### Server

| Tool              | Description                        | Parameters                    |
|-------------------|------------------------------------|-------------------------------|
| `server_version`  | Return the running application version |                            |

### Projects

| Tool              | Description                        | Parameters                    |
|-------------------|------------------------------------|-------------------------------|
| `project_create`  | Create a new project               | `name`                        |
| `project_list`    | List all projects                  |                               |
| `project_delete`  | Delete a project and all its data  | `name`                        |
| `project_history` | Revision history across all tickets in a project: newest first, or after `since` oldest first | `project?`, `since?`, `limit?`, `offset?` |

### Tickets

| Tool              | Description                        | Parameters                                                         |
|-------------------|------------------------------------|--------------------------------------------------------------------|
| `ticket_create`   | Create a new ticket                | `project?`, `title`, `description?`, `benefit?`, `penalty?`, `estimate?`, `risk?` |
| `ticket_list`     | List tickets with filtering and pagination | `project?`, `tag?`, `tags?`, `excludeTags?`, `search?`, `sort?`, `limit?`, `offset?`, `minPriority?`, `minValue?`, `maxCost?` |
| `ticket_update`   | Update a ticket                    | `project?`, `title`, `newTitle?`, `description?`, `benefit?`, `penalty?`, `estimate?`, `risk?` |
| `ticket_upsert`   | Create or update by title (idempotent) | `project?`, `title`, `description?`, `benefit?`, `penalty?`, `estimate?`, `risk?` |
| `ticket_delete`   | Delete a ticket                    | `project?`, `title`                                                |
| `ticket_history`  | Show revision history, oldest first | `project?`, `title?`, `id?`, `limit?`, `offset?`                  |

Score parameters (`benefit`, `penalty`, `estimate`, `risk`) must be Fibonacci values: 1, 2, 3, 5, 8, 13, or 21.

`ticket_list` supports large backlogs with filtering, search, and pagination:

- **Tag intersection**: `tags: ["state:backlog", "team:backend"]` — only tickets matching all tags
- **Exclude tags**: `excludeTags: ["state:done"]` — hide completed items
- **Title search**: `search: "login"` — case-insensitive substring match
- **Score thresholds**: `minPriority`, `minValue`, `maxCost` — filter by calculated fields
- **Pagination**: `limit` + `offset` — response includes `{ total, offset, items }` for paging

The legacy `tag` parameter (single string) is still supported alongside the new `tags` array.

### Tags

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `tag_create`      | Create a tag                       | `project?`, `prefix`, `value`              |
| `tag_assign`      | Assign tags to tickets, creating missing tags | `project?`, `ticket?`, `tickets?`, `prefix?`, `value?`, `tags?` |
| `tag_remove`      | Remove a tag from a ticket         | `project?`, `ticket`, `prefix`, `value`    |
| `tag_list`        | List all tags in a project         | `project?`                                 |
| `tag_delete`      | Delete a tag no ticket holds       | `project?`, `prefix`, `value`             |
| `tag_rename`      | Rename a tag value (assignments carry over) | `project?`, `prefix`, `oldValue`, `newValue` |

Tag prefix and value must be lowercase alphanumeric with hyphens (e.g. `state`, `in-progress`).

`tag_assign` supports batch operations. Provide either `ticket` (single) or `tickets` (array) for targets, and either `prefix`+`value` (single tag) or `tags` (array of `{prefix, value}`) for tags. Every tag is assigned to every ticket. A ticket holds one value per prefix: assigning `state:done` replaces `state:wip` (listed under `replaced` in the result), and requesting two values of one prefix in one call is an error.

```json
// single tag, single ticket (backward compatible)
{ "project": "Acme", "ticket": "Login page", "prefix": "state", "value": "backlog" }

// multiple tags on one ticket
{ "project": "Acme", "ticket": "Login page", "tags": [{"prefix": "state", "value": "backlog"}, {"prefix": "team", "value": "backend"}] }

// one tag on multiple tickets
{ "project": "Acme", "tickets": ["Login page", "Signup flow"], "prefix": "state", "value": "done" }
```

### Weight Configuration

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `weight_get`      | View current weights (defaults: 1.5) | `project?`                               |
| `weight_set`      | Set weights (omitted ones keep current value) | `project?`, `w1?`, `w2?`, `w3?`, `w4?` |
| `weight_reset`    | Reset weights to defaults (all 1.5) | `project?`                               |

### Calculations

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `calc_priority`   | Weighted priorities for all tickets, or those with a tag | `project?`, `tag?`, `w1?`, `w2?`, `w3?`, `w4?` |
| `calc_weights`    | Relative weights as share of total (fraction 0–1) | `project?`, `tag?`                      |

### Relations

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `relation_create` | Create a typed relation between tickets | `project?`, `source`, `type`, `target` |
| `relation_remove` | Remove a relation (both directions) | `project?`, `source`, `type`, `target`    |
| `relation_list`   | List all relations for a ticket    | `project?`, `ticket`                       |
| `relation_list_all` | List every relation in a project | `project?`                                 |

Types: `blocks`, `depends-on`, `relates-to`, `duplicates`, `supersedes`, `precedes`, `tests`, `implements`, `addresses`, `splits-into`, `informs`, `see-also`.

### Reports

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `report_summary`  | Project summary by state           | `project?`, `topN?`                        |
| `report_times`    | Lead and cycle time report         | `project?`                                 |
| `report_health`   | Backlog health report              | `project?`, `threshold?`                   |
| `report_distribution` | Fibonacci score distribution   | `project?`                                 |
| `report_group`    | Group tickets by tag prefix        | `project?`, `prefix`                       |
| `report_dashboard`| Self-contained HTML dashboard      | `project?`, `limit?`                       |

### Event Log & Diff

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `event_log`       | Unified chronological event stream: newest first, or oldest first after `since` (for polling) | `project?`, `since?`, `after?`, `limit?` (default 50) |
| `project_diff`    | Changes since a point in time      | `project?`, `since`                        |

### Export / Import

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `export_csv`      | Export tickets as CSV              | `project?`, `withCalculations?`            |
| `export_json`     | Export project data as JSON        | `project?`, `withHistory?`                 |
| `import_csv`      | Import tickets from CSV string     | `project?`, `csv`                          |
| `import_json`     | Import project data from JSON (creates the project if needed) | `project?`, `json`                         |

`export_json` writes tickets (with their tags), the project's tags, relations and weights; `import_json` takes the same format:

```json
{
  "tickets": [
    { "title": "SSO Integration", "description": null, "benefit": 8, "penalty": 5, "estimate": 5, "risk": 3,
      "tags": [{ "prefix": "state", "value": "backlog" }] },
    { "title": "Audit Log", "benefit": 3, "tags": [] }
  ],
  "tags": [{ "prefix": "state", "value": "backlog" }],
  "relations": [{ "source": "SSO Integration", "type": "blocks", "target": "Audit Log" }],
  "weights": { "w1": 1.5, "w2": 1.5, "w3": 1.5, "w4": 1.5 }
}
```

Only `tickets` and each ticket's `title` are required; scores default to 1. Tags are `{prefix, value}` objects, not `"prefix:value"` strings. An import adds the relations and replaces the project's weights with the file's, and its result says so (`relationsCreated`, `weights`).

## Example Session

```
User: Create a project called "Q3 Roadmap" and add three tickets.

Assistant calls: project_create { name: "Q3 Roadmap" }
Assistant calls: ticket_create { project: "Q3 Roadmap", title: "SSO Integration", benefit: 13, penalty: 8, estimate: 8, risk: 5 }
Assistant calls: ticket_create { project: "Q3 Roadmap", title: "Dashboard Redesign", benefit: 8, penalty: 3, estimate: 5, risk: 3 }
Assistant calls: ticket_create { project: "Q3 Roadmap", title: "API Rate Limiting", benefit: 5, penalty: 5, estimate: 3, risk: 2 }
Assistant calls: calc_priority { project: "Q3 Roadmap" }

Result:
  1. API Rate Limiting  — weighted: 2.0
  2. SSO Integration    — weighted: 1.62
  3. Dashboard Redesign — weighted: 1.38
```

## Troubleshooting

| Message | What to do |
|---------|------------|
| `Tool … not found` | The client talks to an older build. Call `server_version` (or run `rw --version`) and restart the MCP server after upgrading. |
| `No project specified and no .rewelo.json config found` | Pass `project`, or add a `.rewelo.json` with `{"project": "<name>"}` in the server's working directory or a parent (not possible with the Docker image, whose working directory is `/app`). |
| `Project not found` | Check the name with `project_list`; names are matched exactly (after trimming). |
| `The database is locked by another process. Try again later` | Another `rw` process has held the write lock for more than 30 seconds (for example a very large import). Retry when it has finished; reading is not blocked. |
| `The database uses schema version …, but this rewelo supports up to version …` | The database was upgraded by a newer rewelo. Upgrade the server. |
| `The database file is not a rewelo database` | `--db` / `RW_DB_PATH` points at another application's SQLite file. |
| `Rate limit exceeded (100 calls per second). Try again in N s.` | Tool calls start at most 100 per second; calls beyond that wait their turn, and a call that would wait more than 10 seconds is refused. |
| `Request payload too large` | A tool call's text arguments may total at most 1 MB; split an import into several calls. |
| `The result is too large` | Results are limited to 5 MB. Page through `ticket_list` with `limit` and `offset` (it returns 100 tickets by default), and export or render big projects with the `rw` CLI, which writes files. |

To check the server by hand, see [Verifying the Server](#verifying-the-server).

## Validation and Security

All tool inputs pass through the same validation layer as the CLI:

- Project names: alphanumeric, hyphens, underscores, single spaces (max 100 chars)
- Ticket titles: max 500 chars, no null bytes
- Tag prefix/value: lowercase alphanumeric with hyphens only
- Fibonacci scores enforced on all ticket score fields
- Unknown parameters are rejected (a misspelt `benfit` is an error, not ignored)
- SQL injection payloads are harmless (all queries use parameterised statements)
- Error messages never expose SQL, file paths, or stack traces
- Container runs as non-root with a named volume for data isolation
