# MCP Server

Rewelo exposes all functionality as an MCP (Model Context Protocol) server over stdio transport. This lets AI assistants like Claude create projects, manage tickets, assign tags, and calculate priorities directly.

The MCP server runs inside a Docker container. Running it as a bare Node process is not recommended.

## Prerequisites

Build the image once:

```bash
VERSION=$(node -p "require('./package.json').version")
docker build --build-arg APP_VERSION=$VERSION -t rewelo-mcp:$VERSION -t rewelo-mcp:latest .
```

The database is stored inside the container volume at `/data/relative-weight.duckdb` and persists across restarts via the `rw-data` named volume.

## Client Configuration

The MCP client (Claude Desktop, Claude Code, etc.) manages the container lifecycle automatically — it starts the container when needed and stops it when done.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rewelo": {
      "command": "bash",
      "args": ["-c", "docker rm -f rw-mcp >/dev/null 2>&1; docker run --rm -i --init --name rw-mcp --cap-drop=ALL --read-only --tmpfs /tmp --memory=256m -v rw-data:/data rewelo-mcp serve"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root or `~/.claude/mcp.json` globally:

```json
{
  "mcpServers": {
    "rewelo": {
      "command": "bash",
      "args": ["-c", "docker rm -f rw-mcp >/dev/null 2>&1; docker run --rm -i --init --name rw-mcp --cap-drop=ALL --read-only --tmpfs /tmp --memory=256m -v rw-data:/data rewelo-mcp serve"]
    }
  }
}
```

### What this does

- `docker rm -f rw-mcp` removes any stale container from a previous crash
- `--rm` cleans up the container on exit
- `--init` ensures signals (Ctrl+C, SIGTERM) are forwarded correctly
- `--name rw-mcp` gives the container a fixed name
- `-v rw-data:/data` persists the database across container restarts
- `-i` keeps stdin open for stdio transport
- `--cap-drop=ALL` drops all Linux capabilities for minimal attack surface
- `--read-only` makes the root filesystem read-only (only `/data` is writable)
- `--tmpfs /tmp` provides a writable temp directory in memory
- `--memory=256m` limits container memory to 256 MB

## Verifying the Server

Use the MCP inspector to browse tools and test them interactively:

```bash
npx @modelcontextprotocol/inspector docker run --rm -i --init -v rw-data:/data rewelo-mcp serve
```

## Available Tools

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
| `project_history` | Revision history across all tickets in a project | `project`, `since?`, `limit?` |

### Tickets

| Tool              | Description                        | Parameters                                                         |
|-------------------|------------------------------------|--------------------------------------------------------------------|
| `ticket_create`   | Create a new ticket                | `project`, `title`, `description?`, `benefit?`, `penalty?`, `estimate?`, `risk?` |
| `ticket_list`     | List tickets with calculated priority | `project`, `tag?`, `sort?`                                     |
| `ticket_update`   | Update a ticket                    | `project`, `title`, `newTitle?`, `description?`, `benefit?`, `penalty?`, `estimate?`, `risk?` |
| `ticket_upsert`   | Create or update by title (idempotent) | `project`, `title`, `description?`, `benefit?`, `penalty?`, `estimate?`, `risk?` |
| `ticket_delete`   | Delete a ticket                    | `project`, `title`                                                |
| `ticket_history`  | Show revision history              | `project`, `title?`, `id?`                                       |

Score parameters (`benefit`, `penalty`, `estimate`, `risk`) must be Fibonacci values: 1, 2, 3, 5, 8, 13, or 21.

### Tags

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `tag_create`      | Create a tag                       | `project`, `prefix`, `value`              |
| `tag_assign`      | Assign a tag to a ticket           | `project`, `ticket`, `prefix`, `value`    |
| `tag_remove`      | Remove a tag from a ticket         | `project`, `ticket`, `prefix`, `value`    |
| `tag_list`        | List all tags in a project         | `project`                                 |
| `tag_rename`      | Rename a tag value (assignments carry over) | `project`, `prefix`, `oldValue`, `newValue` |

Tag prefix and value must be lowercase alphanumeric with hyphens (e.g. `state`, `in-progress`).

### Weight Configuration

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `weight_get`      | View current weights (defaults: 1.5) | `project`                               |
| `weight_set`      | Set weights (omitted ones keep current value) | `project`, `w1?`, `w2?`, `w3?`, `w4?` |
| `weight_reset`    | Reset weights to defaults (all 1.5) | `project`                               |

### Calculations

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `calc_priority`   | Weighted priorities for all tickets | `project`, `w1?`, `w2?`, `w3?`, `w4?`   |
| `calc_weights`    | Relative weights as percentage of total | `project`                              |

### Relations

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `relation_create` | Create a typed relation between tickets | `project`, `source`, `type`, `target` |
| `relation_remove` | Remove a relation (both directions) | `project`, `source`, `type`, `target`    |
| `relation_list`   | List all relations for a ticket    | `project`, `ticket`                       |

Types: `blocks`, `depends-on`, `relates-to`, `duplicates`, `supersedes`, `precedes`, `tests`, `implements`, `addresses`, `splits-into`, `informs`, `see-also`.

### Reports

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `report_summary`  | Project summary by state           | `project`, `topN?`                        |
| `report_times`    | Lead and cycle time report         | `project`                                 |
| `report_health`   | Backlog health report              | `project`, `threshold?`                   |
| `report_dashboard`| Self-contained HTML dashboard      | `project`                                 |

### Event Log & Diff

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `event_log`       | Unified chronological event stream | `project`, `since?`, `limit?`             |
| `project_diff`    | Changes since a point in time      | `project`, `since`                        |

### Export / Import

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `export_csv`      | Export tickets as CSV              | `project`, `withCalculations?`            |
| `export_json`     | Export project data as JSON        | `project`, `withHistory?`                 |
| `import_csv`      | Import tickets from CSV string     | `project`, `csv`                          |
| `import_json`     | Import project data from JSON      | `project`, `json`                         |

### Backup / Restore

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `backup`          | Backup all projects to JSON        |                                           |
| `restore`         | Restore from a backup JSON string  | `json`                                    |

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

## Validation and Security

All tool inputs pass through the same validation layer as the CLI:

- Project names: alphanumeric, hyphens, underscores, spaces (max 100 chars)
- Ticket titles: max 500 chars, no null bytes
- Tag prefix/value: lowercase alphanumeric with hyphens only
- Fibonacci scores enforced on all ticket score fields
- SQL injection payloads are harmless (all queries use parameterised statements)
- Error messages never expose SQL, file paths, or stack traces
- Container runs as non-root with a named volume for data isolation
