# Rewelo CLI

Prioritisation tool using the relative weight method. Stores data in SQLite.

## Installation

```bash
npm install
npm run build
```

The CLI is available as `rw` (via `npm link`) or directly with `node dist/index.js`.

## Global Options

| Option       | Description                  |
|--------------|------------------------------|
| `--db <path>`| Path to SQLite file, must end in `.db` (default: `./relative-weight.db`) |
| `--json`     | Output as JSON               |
| `--csv`      | Output as CSV (where supported) |
| `--quiet`    | Minimal output: commands that change data print nothing (create prints the new UUID), lists print one item per line |
| `--no-color` | Accepted for compatibility; `rw` never prints colour |
| `--version`  | Show version                 |

An option that takes one value may be given once; `--title A --title B` is an error. Options marked repeatable, such as `--tag`, collect every value.

Only `project create` and `import json` create the database file; other commands report a missing database instead of creating an empty one. The database uses SQLite's write-ahead log, so commands can read while another `rw` process writes; `<name>.db-wal` and `<name>.db-shm` files appear next to the database while it is in use. Back up with `rw export json`, or copy the `.db` file while no `rw` process runs.

## Commands

### project

```bash
rw project create <name>
rw project list
rw project delete <name> [--force]
rw project history --project <name> [--since <timestamp>] [--limit <n>] [--offset <n>]
rw project diff --project <name> --since <timestamp>
```

`delete` prompts for confirmation unless `--force` is passed. `history` lists the revisions of all tickets, newest first; with `--since`, the revisions right after it, oldest first. `--limit` and `--offset` page through them. `diff` compares the project now with its state at `--since`: new, updated and deleted tickets and net tag changes. Timestamps are ISO dates or date-times; without an offset they are read as UTC.

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

rw ticket history --project <name> --title <title> [--limit <n>] [--offset <n>]

rw ticket upsert --project <name> --title <title> [--description <text>] \
  [--benefit <n>] [--penalty <n>] [--estimate <n>] [--risk <n>]
```

`upsert` creates the ticket if no ticket has that title, and updates it otherwise.

Scores use the Fibonacci scale: 1, 2, 3, 5, 8, 13, 21.

- **benefit** / **penalty** form the value side (why do it)
- **estimate** / **risk** form the cost side (what it takes)
- **priority** = value / cost

Sort fields: `priority`, `value`, `cost`, `benefit`, `penalty`, `estimate`, `risk`.

`priority` here, in `report summary` and on the dashboard is always the unweighted value / cost. The project's weights (`config weights`) apply only to the weighted priority that `rw calc priority` shows next to it.

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

JSON output includes `{ total, offset, items }` for pagination. `ticket list` also supports `--csv` output. `ticket history` shows the revision log for a ticket, oldest first; `--limit` and `--offset` page through it.

### tag

Tags use a `prefix:value` format (e.g. `state:wip`, `team:backend`). A prefix works like a field: a ticket holds **one value per prefix**. Assigning `state:done` to a ticket tagged `state:wip` replaces it (the output says `replaced "state:wip"`), and asking for two values of one prefix in one command, e.g. `feature:auth feature:login`, is an error. Use different prefixes for independent classifications.

```bash
rw tag create <prefix:value> --project <name>
rw tag assign <tags...> --project <name> --ticket <title> [--ticket <title>...]
rw tag remove <prefix:value> --project <name> --ticket <title>
rw tag list --project <name>
rw tag delete <prefix:value> --project <name>     # only a tag no ticket holds
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
rw calc weights --project <name> [--tag <prefix:value>...]
rw calc priority --project <name> [--tag <prefix:value>...] [--w1 <n>] [--w2 <n>] [--w3 <n>] [--w4 <n>]
```

- `calc weights` shows each ticket's scores as a share of the total across all tickets, as a fraction between 0 and 1 (e.g. `0.25` = 25%).
- `calc priority` shows both standard priority and weighted priority, sorted descending. Inline `--w1`..`--w4` override the stored config for that run.

### export

```bash
rw export csv --project <name> [--output <path>] [--with-calculations]
rw export json --project <name> [--output <path>] [--with-history]
```

Without `--output`, data is written to stdout. `export json` contains the tickets with their tags, the project's tags, its relations (by ticket title) and its weight configuration.

### import

```bash
rw import csv <file> --project <name>
rw import json <file> --project <name>
```

`import csv` reads the columns written by `export csv`: `title` (required), `description`, `benefit`, `penalty`, `estimate`, `risk` and `tags`; `value`, `cost` and `priority` are ignored. Any other column is an error.

`import json` creates the project if it does not exist yet, and restores relations and weights when the file has them (weights replace the project's current ones). A file written with `--with-history` also restores each ticket's creation and last update time, revisions and tag changes, so lead and cycle times survive a backup and restore. Imports are all-or-nothing: if any row fails, nothing is imported.

### relation

```bash
rw relation create --project <name> --source <title> --type <type> --target <title>
rw relation remove --project <name> --source <title> --type <type> --target <title>
rw relation list --project <name> --ticket <title>
rw relation list-all --project <name>
```

Relation types: `blocks`, `depends-on`, `relates-to`, `duplicates`, `supersedes`, `precedes`, `tests`, `implements`, `addresses`, `splits-into`, `informs`, `see-also`.

### report

```bash
rw report summary --project <name> [--top <n>]
rw report group --project <name> --prefix <prefix>
rw report distribution --project <name>
rw report health --project <name> [--threshold <n>]
rw report times --project <name>
rw report dashboard --project <name> --output <path> [--limit <n>]
rw report event-log --project <name> [--since <timestamp>] [--after <sequence>] [--limit <n>]
```

| Report         | Description |
|----------------|-------------|
| `summary`      | Total tickets, breakdown by `state:` tag, top-N open tickets (not `state:done`) by priority (default 5) |
| `group`        | Group tickets by a tag prefix and show average priority per group |
| `distribution` | Histogram of Fibonacci scores across benefit, penalty, estimate, risk |
| `health`       | High/low priority ratio, total backlog cost, done vs open counts |
| `times`        | Lead time (created → done) and cycle time (wip → done) per ticket |
| `dashboard`    | Self-contained static HTML dashboard: tickets by priority, score distribution, backlog health and a table of relations; the ticket and relation tables show 500 rows unless `--limit` says otherwise |
| `event-log`    | Ticket creations, updates, deletions and tag changes: the newest first (default 50), or after `--since`/`--after`, oldest first. `--after` takes an event's `sequence` (in `--json`) and polls without missing events |

`times` requires `state:wip` and `state:done` tags to be assigned to tickets. States are recognised by name: work starts the first time a ticket gets a tag called `state:wip` at that moment, and a ticket is done while it holds the tag now called `state:done` (`report health` counts done tickets the same way). Renaming a state tag changes its meaning: after `state:done` becomes `state:cancelled`, those tickets are no longer done.

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

The container stores the database at `/data/relative-weight.db`. Use a named volume or bind mount to persist data between runs; without one, rw warns on stderr that the database is lost when the container is removed.
