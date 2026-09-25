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

### Structured results

Every tool that returns data declares an `outputSchema` and returns its result twice: as `structuredContent`, typed and checked against that schema, and as the same JSON in a text block for clients that read only text. A client or script can rely on fields like `priority` and `sequence` without parsing text. On the 2025 protocol, `structuredContent` must be an object, so a list comes wrapped as `{"result": [...]}`; the text block holds the plain list.

`export_csv`, `export_json` and `report_dashboard` return documents (CSV, JSON, HTML) and have no `outputSchema`: their result is the text block alone.

### Questions to the user

When the client can show forms (MCP elicitation), two tools ask the user directly instead of trusting the model to:

- `project_delete` asks the user to confirm, as `rw project delete` does, and names how many tickets go with the project. Unless the user confirms, the project stays and the tool returns an error saying so.
- `ticket_create` asks for the scores the call leaves out, with a drop-down of the Fibonacci values. Scores the user leaves empty, or all of them when the user declines, default to 1. When the user cancels, no ticket is created.

A client without forms gets the previous behaviour: `project_delete` deletes straight away and omitted scores default to 1. Its annotations still mark `project_delete` as destructive, so the client can ask for approval itself.

### Tool annotations

Every tool carries MCP annotations that say what it does to the database, so a client can run read-only tools without asking and warn before destructive ones:

- **Read-only** (`readOnlyHint`): the `*_list`, `*_history`, `*_get`, `calc_*`, `report_*` and `export_*` tools, `event_log`, `project_diff` and `server_version`.
- **Additive** (`destructiveHint: false`): `project_create`, `ticket_create`, `tag_create`, `relation_create` and `import_csv`. They only add data; an existing name or title is an error, not overwritten.
- **Destructive** (`destructiveHint: true`): every other tool. They overwrite or delete data: the deletes, `ticket_update`, `ticket_upsert`, the tag changes, `weight_set`, `weight_reset` and `import_json` (which replaces the weights).
- **Idempotent** (`idempotentHint`): the deletes, `ticket_upsert`, `tag_assign`, `tag_remove`, `weight_set` and `weight_reset`. Repeating the call with the same arguments changes nothing more.

No tool reaches outside the local database (`openWorldHint: false`).

### Server

| Tool              | Description                        | Parameters                    |
|-------------------|------------------------------------|-------------------------------|
| `server_version`  | Return the running application version |                            |

### Projects

| Tool              | Description                        | Parameters                    |
|-------------------|------------------------------------|-------------------------------|
| `project_create`  | Create a new project               | `name`                        |
| `project_list`    | List all projects                  |                               |
| `project_delete`  | Delete a project and all its data, after the user confirms | `name`       |
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
- **Score thresholds**: `minPriority`, `minValue`, `maxCost` — filter by calculated fields. `minPriority` compares the exact value / cost, not the rounded `priority` returned: a ticket returned with 1.62 (21/13 = 1.615…) is below `minPriority: 1.62`
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
| `simulate`        | What-if ranking under hypothetical scores, tickets and weights; writes nothing | `project?`, `tag?`, `changes?`, `add?`, `remove?`, `weights?`, `top?`, `limit?` |
| `explain_priority`| One ticket's formula, rank, and what it takes to reach the top N | `project?`, `title`, `tag?`, `top?` |

`simulate` and `explain_priority` rank as `calc_priority` does: by weighted priority, with the project's weights. They do the arithmetic on the server, so a model doesn't recalculate priorities itself:

```json
// What if C were estimated 1 instead of 5, a new ticket came in, and A were dropped?
{ "project": "Acme", "changes": [{ "title": "C", "estimate": 1 }], "add": [{ "title": "SSO", "benefit": 13, "estimate": 5 }], "remove": ["A"] }
```

`simulate` returns the scenario's top tickets (`top`, default 10) and every ticket that the scenario changes, adds or removes, or that moves, with its rank and priority before and after and `rankChange` (positive: up). Omitted scores of an added ticket are 1; omitted weights keep the project's. Nothing is written: apply a scenario with `ticket_update`.

`explain_priority` returns the formula with the ticket's numbers, e.g. `(1.5 × 3 + 1.5 × 2) / (1.5 × 5 + 1.5 × 3) = 7.5 / 12 = 0.63`, its rank, and for the rank `top` (default 1): the priority of the ticket holding it now, and per score the smallest change of that one score that reaches it (for example estimate 5 → 2).

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

### Change Plans

| Tool              | Description                        | Parameters                                |
|-------------------|------------------------------------|-------------------------------------------|
| `apply_changes`   | Apply many changes in one transaction, or try them with `dryRun` | `project?`, `operations`, `dryRun?`, `top?`, `limit?` |

An agent grooming a backlog makes dozens of calls, and a failure halfway leaves the backlog half-changed. `apply_changes` takes the whole plan as a list of operations and applies all of them or, when one fails, none; the error names the failing operation. With `dryRun: true` nothing is written, and the result shows what the plan would do, so the user can review it once instead of approving each call:

```json
{ "project": "Acme", "dryRun": true, "operations": [
  { "op": "ticket_create", "title": "SSO", "benefit": 21, "penalty": 13, "estimate": 2, "risk": 1 },
  { "op": "ticket_update", "title": "Audit Log", "estimate": 3 },
  { "op": "tag_assign", "ticket": "Login page", "tag": "state:done" },
  { "op": "relation_create", "source": "SSO", "type": "blocks", "target": "Audit Log" },
  { "op": "ticket_delete", "title": "Old idea" }
] }
```

Operations: `ticket_create`, `ticket_update`, `ticket_delete`, `tag_assign` and `tag_remove` (with `tag` as `prefix:value`; `tag_assign` creates a missing tag), `relation_create` and `relation_remove`, each with the parameters of the tool of that name. At most 1,000 per call. The result lists each operation's outcome (`ticket_update` with the fields it changed) and, under `ranking`, how the ranking changes as `simulate` shows it: the new top tickets and every ticket created, updated, deleted or moved.

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

## Resources

Resources are context a user attaches to a conversation without a tool call; in Claude Code, type `@rewelo:` and pick one. Names in the URI are percent-encoded (`My Project` is `My%20Project`), and clients can autocomplete the project and the ticket title.

| Resource URI                          | Content                                                                                   | Type               |
|---------------------------------------|-------------------------------------------------------------------------------------------|--------------------|
| `rewelo://{project}/backlog`          | Open tickets (not `state:done`), ranked as `calc_priority` ranks them, with scores, priorities and tags | `application/json` |
| `rewelo://{project}/ticket/{title}`   | One ticket with description, scores, priorities, tags and relations                       | `application/json` |
| `rewelo://{project}/dashboard`        | The HTML dashboard, as `report_dashboard` renders it                                      | `text/html`        |
| `rewelo://{project}/dashboard/{limit}` | The dashboard with at most `limit` rows per table                                        | `text/html`        |
| `rewelo://{project}/export/{format}`  | The export as `export_csv` or `export_json` returns it; `format` is `csv`, `csv-with-calculations`, `json` or `json-with-history` | `text/csv`, `application/json` |

The resource list offers a backlog and a dashboard per project; tickets and exports aren't listed, as a project can have thousands of tickets. Reading a resource counts against the same rate limit as a tool call. The backlog and a ticket, which are meant as context for the model, are limited to 5 MB like a tool result; dashboards and exports, which a client fetches on its own, to 32 MB.

`export_csv`, `export_json` and `report_dashboard` return their document inline up to 5 MB. Over that, they return a `resource_link` to the matching resource above instead of an error, so a client can fetch the document without it going through the model's context.

## Live events

### Resource subscriptions

A client can subscribe to any `rewelo://` resource. The server then sends `notifications/resources/updated` for it when the database changes: through one of its own tools, or through another process, such as the `rw` CLI or another session's server on the same database. It looks for changes every 2 seconds while anything is subscribed, and sends the notification for every subscribed resource, whichever project changed.

### Claude Code channel (research preview)

With `rw serve --channel`, the server pushes changes made outside the session into Claude Code as [channel](https://code.claude.com/docs/en/channels) messages, and Claude can react, for example by offering scores for a new ticket, without polling. Each event in the event log becomes one message, such as:

```
<channel source="rewelo" project="Acme" event="ticket_created" ticket="Login page" sequence="42">
New ticket "Login page" in Acme (benefit 13, penalty 5, estimate 3, risk 2).
</channel>
```

Changes the session makes through its own tool calls are not pushed back to it. At most 20 events per project are pushed at a time; more are summed up in one message pointing to `event_log`. The server's instructions tell Claude that titles in these messages are data, not instructions.

To try it, add `--channel` after `serve` in the server's arguments, and start Claude Code with `claude --dangerously-load-development-channels server:rewelo` (for Team and Enterprise organisations, an admin has to allow channels). Channels are a research preview in Claude Code: the protocol may change, and a client that doesn't support them ignores the messages.

## Prompts

The server also offers prompts: ready-made instructions for common backlog work, which a client shows as commands (in Claude Code, for example, `/mcp__rewelo__plan-sprint Acme 30`). Each one tells the model which tools to call and how to present the result.

| Prompt           | What it does                                                     | Arguments                        |
|------------------|------------------------------------------------------------------|----------------------------------|
| `intake`         | Interview a stakeholder and create scored tickets                | `project?`                       |
| `plan-sprint`    | Propose a sprint backlog from the priorities and a capacity      | `project?`, `capacity-points?`   |
| `standup`        | Daily digest: progress, blockers, sprint health                  | `project?`                       |
| `slice`          | Split a large ticket into smaller ones with distributed scores   | `project?`, `ticket-title?`      |
| `reprioritize`   | Reassess priorities after an event                               | `project?`, `event-description?` |
| `what-if`        | Explore scenarios with `simulate`, without changing data         | `project?`                       |
| `flow-metrics`   | Lead time, cycle time and throughput from state tags             | `project?`                       |
| `retro-accuracy` | Compare estimates with outcomes to find scoring biases           | `project?`                       |
| `portfolio`      | Compare value and effort across all projects                     | none                             |

Without `project`, a prompt uses the server's default project (see [Available Tools](#available-tools)), or tells the model to ask. The client can autocomplete `project` from the existing projects and `ticket-title` from the titles in the chosen project.

The prompts are the Claude Code skills in [`.claude/skills`](.claude/skills), built into the server by `scripts/generate-prompts.mjs`: change a skill there, and the prompt changes with the next build.

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
| `The result is too large` | Tool results are limited to 5 MB. Page through `ticket_list` with `limit` and `offset` (it returns 100 tickets by default). Exports and dashboards over 5 MB come as a link to a resource, which may be up to 32 MB; beyond that, export or render with the `rw` CLI, which writes files. |

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
