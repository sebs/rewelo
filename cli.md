# Rewelo CLI

Prioritisation tool using the relative weight method. Stores data in DuckDB.

## Installation

```bash
npm install
npm run build
```

The CLI is available as `rw` (via `npm link`) or directly with `node dist/index.js`.

## Global Options

| Option       | Description                  |
|--------------|------------------------------|
| `--db <path>`| Path to DuckDB file (default: `./relative-weight.duckdb`) |
| `--json`     | Output as JSON               |
| `--csv`      | Output as CSV (where supported) |
| `--quiet`    | Minimal output               |
| `--no-color` | Disable colour output        |
| `--version`  | Show version                 |

## Commands

### project

```bash
rw project create <name>
rw project list
rw project delete <name> [--force]
```

`delete` prompts for confirmation unless `--force` is passed.

### ticket

```bash
rw ticket create --project <name> --title <title> [--description <text>] \
  [--benefit <n>] [--penalty <n>] [--estimate <n>] [--risk <n>]

rw ticket list --project <name> [--tag <prefix:value>...] \
  [--exclude-tag <prefix:value>...] [--search <text>] \
  [--sort <field>] [--limit <n>] [--offset <n>] \
  [--min-priority <n>] [--min-value <n>] [--max-cost <n>]

rw ticket update --project <name> --title <title> [--new-title <title>] \
  [--description <text>] [--benefit <n>] [--penalty <n>] \
  [--estimate <n>] [--risk <n>]

rw ticket delete --project <name> --title <title>

rw ticket history --project <name> --title <title>
```

Scores use the Fibonacci scale: 1, 2, 3, 5, 8, 13, 21.

- **benefit** / **penalty** form the value side (why do it)
- **estimate** / **risk** form the cost side (what it takes)
- **priority** = value / cost

Sort fields: `priority`, `value`, `cost`, `benefit`, `penalty`, `estimate`, `risk`.

`ticket list` supports filtering, search, pagination, and score thresholds:

```bash
# multiple tag filters (intersection)
rw ticket list --project Acme --tag state:backlog --tag team:backend

# exclude done items
rw ticket list --project Acme --exclude-tag state:done

# search by title
rw ticket list --project Acme --search "login"

# pagination
rw ticket list --project Acme --sort priority --limit 20
rw ticket list --project Acme --sort priority --limit 20 --offset 20

# score thresholds
rw ticket list --project Acme --min-priority 1.5
rw ticket list --project Acme --max-cost 5       # quick wins
rw ticket list --project Acme --min-value 10      # high-value items
```

JSON output includes `{ total, offset, items }` for pagination. `ticket list` also supports `--csv` output. `ticket history` shows the revision log for a ticket.

### tag

Tags use a `prefix:value` format (e.g. `state:wip`, `team:backend`).

```bash
rw tag create <prefix:value> --project <name>
rw tag assign <tags...> --project <name> --ticket <title> [--ticket <title>...]
rw tag remove <prefix:value> --project <name> --ticket <title>
rw tag list --project <name>
rw tag rename --project <name> --prefix <prefix> --old <value> --new <value>
rw tag log --project <name> --ticket <title>
```

`tag assign` auto-creates tags if they don't exist. It accepts multiple tags and multiple `--ticket` flags, assigning every tag to every ticket:

```bash
# multiple tags on one ticket
rw tag assign state:backlog priority:p1 --project Acme --ticket "Login page"

# one tag on multiple tickets
rw tag assign state:done --project Acme --ticket "Login page" --ticket "Signup flow"

# both combined (cross product)
rw tag assign state:wip team:backend --project Acme --ticket "Login page" --ticket "Signup flow"
```

`tag log` shows the audit trail of tag changes on a ticket.

### config

```bash
rw config weights --project <name>                    # view
rw config weights --project <name> --set --w1 2 --w3 1  # set (omitted weights keep current value)
rw config weights --project <name> --reset             # reset to defaults (all 1.5)
```

Weights `w1`-`w4` control how much each factor contributes to weighted priority:
- **w1** = benefit weight
- **w2** = penalty weight
- **w3** = estimate weight
- **w4** = risk weight

### calc

```bash
rw calc weights --project <name> [--tag <prefix:value>]
rw calc priority --project <name> [--w1 <n>] [--w2 <n>] [--w3 <n>] [--w4 <n>]
```

- `calc weights` shows each ticket's scores as a percentage of the total across all tickets.
- `calc priority` shows both standard priority and weighted priority, sorted descending. Inline `--w1`..`--w4` override the stored config for that run.

### export

```bash
rw export csv --project <name> [--output <path>] [--with-calculations]
rw export json --project <name> [--output <path>] [--with-history]
```

Without `--output`, data is written to stdout.

### import

```bash
rw import csv <file> --project <name>
rw import json <file> --project <name>
```

### relation

```bash
rw relation create --project <name> --source <title> --type <type> --target <title>
rw relation remove --project <name> --source <title> --type <type> --target <title>
rw relation list --project <name> --ticket <title>
```

Relation types: `blocks`, `depends-on`, `relates-to`, `duplicates`, `supersedes`, `precedes`, `tests`, `implements`, `addresses`, `splits-into`, `informs`, `see-also`.

### report

```bash
rw report summary --project <name> [--top <n>]
rw report group --project <name> --prefix <prefix>
rw report distribution --project <name>
rw report health --project <name> [--threshold <n>]
rw report times --project <name>
rw report dashboard --project <name> --output <path>
```

| Report         | Description |
|----------------|-------------|
| `summary`      | Total tickets, breakdown by `state:` tag, top-N by priority (default 5) |
| `group`        | Group tickets by a tag prefix and show average priority per group |
| `distribution` | Histogram of Fibonacci scores across benefit, penalty, estimate, risk |
| `health`       | High/low priority ratio, total backlog cost, done vs open counts |
| `times`        | Lead time (created → done) and cycle time (wip → done) per ticket |
| `dashboard`    | Self-contained HTML dashboard with priority tables, distributions, and dependency graph |

`times` requires `state:wip` and `state:done` tags to be assigned to tickets.

### backup / restore

```bash
rw backup --output <path>
rw restore <file>
```

`backup` exports all projects, tickets, tags, and weights to a JSON file. `restore` imports from a backup file; target database must not contain projects with the same names.

### serve (MCP)

```bash
rw serve [--db <path>]
```

Starts the MCP server over stdio. The database path can also be set via the `RW_DB_PATH` environment variable.

## Docker

```bash
# Build
docker build -t rw .

# Run CLI commands
docker run --rm -v rw-data:/data rw project list

# Run MCP server
docker run --rm -i -v rw-data:/data rw serve
```

The container stores the database at `/data/relative-weight.duckdb`. Use a named volume or bind mount to persist data between runs.
