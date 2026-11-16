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

Only `project create` and `import json` create the database file; other commands report a missing database instead of creating an empty one. The database uses SQLite's write-ahead log, so commands can read while another `rw` process writes; `<name>.db-wal` and `<name>.db-shm` files appear next to the database while it is in use. Back up with `rw export json`, or copy the `.db` file while no `rw` process runs. A database from an older rewelo is upgraded when it is first opened. Titles and project names that older versions accepted but today's rules reject (such as `.`, line breaks, invisible characters or `My  Project`) get the nearest accepted name then; a renamed ticket keeps its old title in its history, and a `.rewelo.json` naming a renamed project needs the new name.

### Default project

Every `--project <name>` below may be left out when a `.rewelo.json` names the project. rw looks for it in the current directory, then in each parent directory, and uses the first it finds:

```json
{ "project": "Acme" }
```

`project` is its only key; a malformed file is an error rather than a reason to look further up. `--project` given on the command line wins over the file.

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

`--min-priority` (like `report health --threshold`) compares the exact value / cost, not the two decimals shown: a ticket shown with 1.62 (21/13 = 1.615…) is below `--min-priority 1.62`.

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
rw calc priority --project <name> [--tag <prefix:value>...] [--w1 <n>] [--w2 <n>] [--w3 <n>] [--w4 <n>] [--unblocked]
rw calc plan --project <name> --capacity <n> [--effort estimate|cost] [--tag <prefix:value>...] [--exclude-tag <prefix:value>...]
```

- `calc weights` shows each ticket's scores as a share of the total across all tickets, as a fraction between 0 and 1 (e.g. `0.25` = 25%).
- `calc priority` shows both standard priority and weighted priority, sorted descending. Inline `--w1`..`--w4` override the stored config for that run.
- When a ticket is blocked, `calc priority` adds a `Blocked by` column with its open blockers (`blockedBy` under `--json`): the tickets that `blocks` it or that it `depends-on`, and that are not `state:done`. `--unblocked` leaves blocked tickets out, to list what can be started now.
- `calc plan` lists the open tickets that fit a capacity, by weighted priority, in the order to work on them: each ticket with its open blockers before it, and skipped when they don't fit together. A ticket takes its estimate from the capacity, or with `--effort cost` its estimate + risk. The `For` column names the ticket a blocker was pulled in for; below the table, `Didn't fit` names the higher-ranked tickets that didn't fit and what they need. `--exclude-tag state:wip` leaves out work already under way (such tickets are still pulled in as blockers). `--json` prints the whole plan.

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

`import json` creates the project if it does not exist yet, and restores relations and weights when the file has them (weights replace the project's current ones). A file written with `--with-history` also restores each ticket's creation and last update time, revisions and tag changes, and the project's deleted tickets, so lead and cycle times, the event log and `project diff` survive a backup and restore. A relation of the file that the others contradict (the reverse of one, one in the opposite order, or one closing a cycle, as older versions could store) is left out, and the output names it with the reason; everything else is imported. Keys the JSON format doesn't have are refused, so a misspelt key (`benfit`) isn't dropped silently. Imports are all-or-nothing: if any row fails, nothing is imported.

### relation

```bash
rw relation create --project <name> --source <title> --type <type> --target <title>
rw relation remove --project <name> --source <title> --type <type> --target <title>
rw relation list --project <name> --ticket <title>
rw relation list-all --project <name>
```

Relation types: `blocks`, `depends-on`, `relates-to`, `duplicates`, `supersedes`, `precedes`, `tests`, `implements`, `addresses`, `splits-into`, `informs`, `see-also`. Each asymmetric type has an inverse name, which listings show from the other ticket's side and which is accepted as well: `is-blocked-by`, `is-depended-on-by`, `is-duplicated-by`, `is-superseded-by`, `follows`, `is-tested-by`, `is-implemented-by`, `is-addressed-by`, `is-split-from`, `is-informed-by`. `A is-blocked-by B` is `B blocks A`.

A relation can't contradict an existing one: `B blocks A` is refused when `A blocks B` exists, and so are `A depends-on B` and `B precedes A`, which put the two tickets in the opposite order. Nor can the ordering relations (`blocks`, `precedes`, `depends-on`) close a cycle through other tickets: with `A blocks B` and `B blocks C`, `C blocks A` is refused, as no ticket in it could be started first.

### report

```bash
rw report summary --project <name> [--top <n>]
rw report group --project <name> --prefix <prefix>
rw report distribution --project <name>
rw report health --project <name> [--threshold <n>] [--stale-days <n>]
rw report times --project <name>
rw report flow --project <name> [--weeks <n>]
rw report forecast --project <name> [--items <n>] [--history-days <n>]
rw report estimates --project <name>
rw report changes --project <name> [--since <timestamp>]
rw report dashboard --project <name> --output <path> [--limit <n>] [--watch]
rw report event-log --project <name> [--since <timestamp>] [--after <sequence>] [--limit <n>]
```

| Report         | Description |
|----------------|-------------|
| `summary`      | Total tickets, breakdown by `state:` tag, top-N open tickets (not `state:done`) by priority (default 5) |
| `group`        | Group tickets by a tag prefix and show average priority per group |
| `distribution` | Histogram of Fibonacci scores across benefit, penalty, estimate, risk |
| `health`       | High/low priority ratio, total backlog cost, done vs open counts, and the open tickets not re-scored for `--stale-days` (default 90): the 10 oldest in the text, all of them under `--json` (`staleTickets`, with `scoredAt` and `days`); a change of title, description or tags doesn't count as re-scoring |
| `times`        | Lead time (created → done) and cycle time (wip → done) per ticket |
| `forecast`     | When the open tickets (or `--items` of them) will be done at the pace of the last `--history-days` (default 90): the date in 50, 85 and 95% of 10,000 simulated runs |
| `estimates`    | Whether estimates predict cycle time: median and 85th percentile of cycle time per estimate (as it was when work started), their rank correlation and what it means |
| `changes`      | What changed in the ranking since `--since` (default 7 days ago), and why: per ticket with a change of its own the rank then and now and the reasons |
| `flow`         | Tickets done per week over the last `--weeks` complete weeks (default 12, 0 for all) and the current week so far, cycle and lead time as 50th/85th/95th percentiles, and the tickets in progress by age |
| `dashboard`    | Self-contained static HTML dashboard: backlog health, a cumulative flow diagram with a forecast, tickets by priority, the ranking changes of the last 7 days, a graph of the dependencies, score distribution and a table of relations; the ticket and relation tables show 500 rows unless `--limit` says otherwise; `--watch` keeps the file up to date |
| `event-log`    | Ticket creations, updates, deletions and tag changes: the newest first (default 50), or after `--since`/`--after`, oldest first. `--after` takes an event's `sequence` (in `--json`) and polls without missing events |

`times` requires `state:wip` and `state:done` tags to be assigned to tickets. States are recognised by name: work starts the first time a ticket gets a tag called `state:wip` at that moment, and a ticket is done while it holds the tag now called `state:done` (`report health` counts done tickets the same way). Renaming a state tag changes its meaning: after `state:done` becomes `state:cancelled`, those tickets are no longer done.

`flow` gives times as percentiles, which an average hides: "85% within 6 days" says what to expect of most tickets, while one ticket that took months moves the average. The percentiles are taken over the tickets done in the window (nearest rank, so each is a time some ticket took). The tickets in progress are those started and not done, oldest first; those already older than the 85th percentile of cycle time are flagged, as they are stuck or about to be late. Weeks start on Monday, UTC.

The dashboard's dependency graph shows the open tickets that block others (`blocks`, `depends-on`) from left to right: each stands after the ones it waits for. Each box shows the ticket's rank and priority, as in the ticket table, and how many open tickets it holds up, directly or through others. A red edge is an inversion: a ticket waiting for one with a lower priority, which the ranking alone hides; they are also listed in words below the graph. Done tickets block nothing and are left out. A graph of more than 80 tickets shows the 80 highest-ranked.

`changes` compares the open tickets by priority (value / cost, as the dashboard and `report summary` rank) at `--since` and now. It lists the tickets with a change of their own: new, done, reopened, re-scored (with the scores from and to), now blocked by a ticket, or no longer blocked because the blocker is done. A ticket that only moved because others did is counted, not listed: a new ticket at the top moves every other one down. The state then comes from the history: scores from the revisions, done from the tag changes, blockers from when the relations were made. What the history doesn't keep can't explain a move: weight changes (which don't affect this ranking), relations removed since, and the scores of deleted tickets, which are listed by title. The dashboard shows the changes of the last 7 days, at most 20 of them.

`forecast` doesn't use estimates but the pace the project actually had. A Monte Carlo simulation replays days drawn at random from the history (how many tickets were done on each, weekends and slow days included) until the tickets are done, 10,000 times; the 85% date is the one by which 85% of the runs were done. It counts tickets, not their size, and assumes the coming weeks look like the recent ones: re-run it as the pace changes. The same data gives the same forecast. Without a ticket done in the history there is no pace, and no forecast. The dashboard shows the forecast for the open tickets under the cumulative flow. For how much fits into a capacity of estimate points, see `rw calc plan`.

`estimates` checks the estimates against what happened: estimate is half of cost in the priority formula, so the ranking is only as good as they are. It looks at the done tickets with a cycle time and takes the estimate each had when work started; a ticket re-estimated afterwards, often to what it turned out to take, would make the estimates look better than they were. Spearman's rank correlation says whether larger estimates took longer: from 0.6 well, from 0.3 somewhat, under that not at all. It needs at least 5 tickets.

The dashboard's cumulative flow diagram counts, at the end of each day (UTC), the tickets that have arrived (were created), started (first got `state:wip`, or `state:done` without it) and are done, by the same rules; deleted tickets aren't counted. It shows the last 30 days and switches to 14, 90 or 365 days or all days since the first ticket; the y axis starts 3 tickets below the lowest done count in the window. Read across, the distance between the arrived and done areas is the lead time; read down, the band between started and done is the work in progress.

With `--watch`, `report dashboard` keeps running and writes the file again whenever the database changes, by `rw` in another terminal or by the MCP server, and when the day changes. It checks every 2 seconds and stops with Ctrl-C. Next to the page it writes `<name>.version.js` with the version the page shows; a page open in a browser loads that file every 2 seconds and reloads when the version differs, keeping the chosen window and the scroll position. Without `--watch` the page has no script.

### serve (MCP)

```bash
rw serve [--db <path>] [--channel]
```

Starts the MCP server over stdio. The database path can also be set via the `RW_DB_PATH` environment variable. `--channel` pushes changes made outside the session into Claude Code as channel messages; see [Live events](mcp.md#live-events).

## Docker

```bash
# Build (APP_VERSION labels the image; rw --version works without it)
docker build --build-arg APP_VERSION="$(node -p "require('./package.json').version")" -t rw .

# Run CLI commands
docker run --rm -v rw-data:/data rw project list

# Run MCP server
docker run --rm -i -v rw-data:/data rw serve
```

The container stores the database at `/data/relative-weight.db`. Use a named volume or bind mount to persist data between runs; without one, rw warns on stderr that the database is lost when the container is removed.
