# rewelo Examples

Each scenario below is shown two ways: as a prompt you paste into Claude Code, which uses the rewelo [MCP server](mcp.md), and as `rw` commands for the [command line](cli.md). Both reach the same database and apply the same validation, so you can mix them: import from the shell, then ask Claude what to do next.

The MCP examples use the backlog from [`fixtures/stories.csv`](fixtures/stories.csv) — 40 user stories for a prioritization tool, scored on benefit, penalty, estimate, and risk. The CLI examples use five of those stories, written in the columns `rw import csv` reads, so the output shown is exactly what you get.

---

## Import a Backlog

**Scenario.** You just exported stories from a spreadsheet. You want to import them, organise them by feature area, and figure out which items deliver the most value for the least effort.

### With Claude Code (MCP)

> **Prompt you can paste into Claude Code:**
>
> *Create a new rewelo project called "prio-tool". Then read the file `fixtures/stories.csv` and import the stories with the rewelo `import_csv` tool: give each story a short title, use its text as the description and its feature as a `feature:` tag.*

The spreadsheet's columns (`story_id`, `feature_id`, `text`, …) are not the ones `import_csv` reads (`title`, `description`, `benefit`, `penalty`, `estimate`, `risk`, `tags`), so Claude converts the rows first. Behind the scenes, Claude will call:

```
mcp tool: project_create  { "name": "prio-tool" }
mcp tool: import_csv      { "project": "prio-tool", "csv":
  "title,description,benefit,penalty,estimate,risk,tags
   Auto-calculate priority scores,\"As a User, I want the system to automatically calculate priority scores …\",8,5,5,3,feature:feature-1
   API access,\"As a Developer, I want API access to the prioritization system, …\",8,5,5,3,feature:feature-7
   …" }
→ { "imported": 40 }
```

### From the command line

`rw import csv` reads the columns `title`, `description`, `benefit`, `penalty`, `estimate`, `risk` and `tags`. Save this as `backlog.csv`:

```csv
title,description,benefit,penalty,estimate,risk,tags
Auto-calculate priority scores,"Score tickets on benefit, penalty, estimate and risk",8,5,5,3,feature:scoring
Custom weights,Tailor the calculation to the organisation's values,5,3,2,1,feature:scoring
Priority matrix view,Visualise the distribution of priorities,8,3,8,5,feature:views
Filters and sorting,Focus on relevant subsets of the backlog,5,2,2,1,feature:views
API access,Integrate prioritisation with other tools,13,8,8,5,feature:api
```

Then create the project, import the file and list the tickets by priority:

```bash
$ rw project create prio-tool
Created project "prio-tool" (f7fd3b06-9b96-4632-bf3a-80ef062e755e)

$ rw import csv backlog.csv --project prio-tool
Imported 5 tickets

$ rw ticket list --project prio-tool --sort priority
Title                          |  B | P | E | R | Value | Cost | Priority
------------------------------ | -- | - | - | - | ----- | ---- | --------
Custom weights                 |  5 | 3 | 2 | 1 |     8 |    3 |     2.67
Filters and sorting            |  5 | 2 | 2 | 1 |     7 |    3 |     2.33
Auto-calculate priority scores |  8 | 5 | 5 | 3 |    13 |    8 |     1.63
API access                     | 13 | 8 | 8 | 5 |    21 |   13 |     1.62
Priority matrix view           |  8 | 3 | 8 | 5 |    11 |   13 |     0.85
```

The database is `./relative-weight.db` unless you pass `--db <path>`. To add a single ticket instead, use `rw ticket create --project prio-tool --title "…" --benefit 8 --penalty 5 --estimate 3 --risk 2`.

---

## Add Dependencies

**Scenario.** Some stories can't start before others are done, and you want that recorded next to the scores.

### With Claude Code (MCP)

> **Prompt you can paste into Claude Code:**
>
> *Read fixtures/dependencies.csv and create those relations in rewelo*

Behind the scenes, Claude will map story IDs to ticket titles and call `relation_create` for each row:

```
mcp tool: relation_create {
  "project": "prio-tool",
  "source": "API access",
  "type": "depends-on",
  "target": "Auto-calculate priority scores"
}
→ { "created": true, "source": "API access", "type": "depends-on", "target": "Auto-calculate priority scores" }

mcp tool: relation_create {
  "project": "prio-tool",
  "source": "User feedback tool integration",
  "type": "depends-on",
  "target": "API access"
}
```

### From the command line

Relations name tickets by title:

```bash
$ rw relation create --project prio-tool --source "API access" --type depends-on --target "Auto-calculate priority scores"
Created: "API access" depends-on "Auto-calculate priority scores"

$ rw relation create --project prio-tool --source "Custom weights" --type depends-on --target "Auto-calculate priority scores"
Created: "Custom weights" depends-on "Auto-calculate priority scores"

$ rw relation list --project prio-tool --ticket "Auto-calculate priority scores"
Type              | Direction | Ticket
----------------- | --------- | --------------
is-depended-on-by | incoming  | API access
is-depended-on-by | incoming  | Custom weights
```

`rw relation list-all --project prio-tool` lists every relation in the project.

Commonly used relation types:

| Type | Use when... |
|------|-------------|
| `depends-on` | A can't start until B is done |
| `blocks` | A prevents B from starting |
| `relates-to` | Loosely connected, no ordering |
| `splits-into` | A was broken down into B |
| `see-also` | Reference link, no dependency |

The [CLI reference](cli.md#relation) lists all twelve.

---

## Priority with Custom Weights

**Scenario.** Delivering value matters more to you than avoiding penalties, and risk should weigh twice as much as effort.

### With Claude Code (MCP)

> **Prompt you can paste into Claude Code:**
>
> *In rewelo project "prio-tool", show me the priorities with benefit weighted 3, penalty 1, estimate 1 and risk 2. If the ranking looks right, keep those weights for the project.*

Behind the scenes, Claude will first try the weights for one call, then store them:

```
mcp tool: calc_priority { "project": "prio-tool", "w1": 3, "w2": 1, "w3": 1, "w4": 2 }
→ [{ "title": "...", "priority": ..., "weighted": ... }, ...]   (sorted by weighted priority)

mcp tool: weight_set    { "project": "prio-tool", "w1": 3, "w2": 1, "w3": 1, "w4": 2 }
→ { "project_id": 1, "w1": 3, "w2": 1, "w3": 1, "w4": 2 }
```

### From the command line

Try the weights for one run, then store them for the project:

```bash
$ rw calc priority --project prio-tool --w1 3 --w2 1 --w3 1 --w4 2
Weights: w1=3 w2=1 w3=1 w4=2

Title                          | Priority | Weighted
------------------------------ | -------- | --------
Custom weights                 |     2.67 |     4.50
Filters and sorting            |     2.33 |     4.25
Auto-calculate priority scores |     1.63 |     2.64
API access                     |     1.62 |     2.61
Priority matrix view           |     0.85 |     1.50

$ rw config weights --project prio-tool --set --w1 3 --w2 1 --w3 1 --w4 2
Set weights for "prio-tool": w1=3 w2=1 w3=1 w4=2
```

From now on `rw calc priority --project prio-tool` uses the stored weights. `rw config weights --project prio-tool --reset` goes back to the defaults.

Weighted priority is `(w1·benefit + w2·penalty) / (w3·estimate + w4·risk)`; see [calculations.md](calculations.md). Each weight is 0 or between 0.01 and 100, and `w3` and `w4` can't both be 0. `weight_reset` (MCP) and `--reset` (CLI) go back to the defaults (all 1.5).

---

## Find Quick Wins

**Scenario.** The team has a short gap before the next release and wants something valuable that is cheap to do.

### With Claude Code (MCP)

> **Prompt you can paste into Claude Code:**
>
> *Which tickets in rewelo project "prio-tool" cost 5 or less? Order them by priority and suggest one to start with.*

Behind the scenes, Claude will call:

```
mcp tool: ticket_list { "project": "prio-tool", "maxCost": 5, "sort": "priority" }
→ { "total": 2, "offset": 0, "items": [
    { "title": "Custom weights", "value": 8, "cost": 3, "priority": 2.67, … },
    { "title": "Filters and sorting", "value": 7, "cost": 3, "priority": 2.33, … } ] }
```

### From the command line

```bash
$ rw ticket list --project prio-tool --max-cost 5 --sort priority
Title               | B | P | E | R | Value | Cost | Priority
------------------- | - | - | - | - | ----- | ---- | --------
Custom weights      | 5 | 3 | 2 | 1 |     8 |    3 |     2.67
Filters and sorting | 5 | 2 | 2 | 1 |     7 |    3 |     2.33
```

`--min-value` and `--min-priority` filter the same way (`minValue` and `minPriority` over MCP).

---

## Track Work and Report Progress

**Scenario.** Work has started. You want to record which tickets are in progress and done, and see where the backlog stands.

### With Claude Code (MCP)

> **Prompt you can paste into Claude Code:**
>
> *In rewelo project "prio-tool", put every ticket in state backlog. "Auto-calculate priority scores" and "Custom weights" are in progress, and "Auto-calculate priority scores" is done. Then give me a summary with the top 3 open tickets and the average priority per feature.*

Behind the scenes, Claude will call:

```
mcp tool: tag_assign { "project": "prio-tool",
  "tickets": ["Priority matrix view", "Filters and sorting", "API access"],
  "prefix": "state", "value": "backlog" }

mcp tool: tag_assign { "project": "prio-tool",
  "tickets": ["Auto-calculate priority scores", "Custom weights"],
  "prefix": "state", "value": "wip" }

mcp tool: tag_assign { "project": "prio-tool",
  "ticket": "Auto-calculate priority scores", "prefix": "state", "value": "done" }
→ [{ "ticket": "Auto-calculate priority scores", "tag": "state:done", "status": "assigned", "replaced": ["state:wip"] }]

mcp tool: report_summary { "project": "prio-tool", "topN": 3 }
→ { "totalTickets": 5, "byState": { "done": 1, "wip": 1, "backlog": 3 }, "withoutState": 0,
    "topByPriority": [{ "title": "Custom weights", "priority": 2.67 }, …] }

mcp tool: report_group { "project": "prio-tool", "prefix": "feature" }
→ [{ "value": "scoring", "ticketCount": 2, "averagePriority": 2.15 }, …]
```

A ticket holds one value per prefix, so `state:done` replaces `state:wip`.

### From the command line

`rw tag assign` takes several tags and several `--ticket` flags at once:

```bash
$ rw tag assign state:backlog --project prio-tool --ticket "Priority matrix view" --ticket "Filters and sorting" --ticket "API access"
Assigned "state:backlog" to "Priority matrix view"
Assigned "state:backlog" to "Filters and sorting"
Assigned "state:backlog" to "API access"

$ rw tag assign state:wip --project prio-tool --ticket "Auto-calculate priority scores" --ticket "Custom weights"
Assigned "state:wip" to "Auto-calculate priority scores"
Assigned "state:wip" to "Custom weights"

$ rw tag assign state:done --project prio-tool --ticket "Auto-calculate priority scores"
Assigned "state:done" to "Auto-calculate priority scores" (replaced "state:wip")

$ rw report summary --project prio-tool --top 3
Project: prio-tool
Total tickets: 5
  state:done: 1
  state:wip: 1
  state:backlog: 3

Top 3 open by priority:
  1. Custom weights (2.67)
  2. Filters and sorting (2.33)
  3. API access (1.62)

$ rw report group --project prio-tool --prefix feature
Value   | Tickets | Avg Priority
------- | ------- | ------------
scoring |       2 |         2.15
api     |       1 |         1.62
views   |       2 |         1.59

$ rw report health --project prio-tool
Project: prio-tool
Total: 5 | Done: 1 | Open: 4
High priority: 3 | Low priority: 1
High:Low ratio: 3
Total backlog cost: 32
```

`rw report times --project prio-tool` shows lead and cycle times once tickets move through `state:wip` and `state:done`.

---

## Script the CLI

**Scenario.** You want rewelo's ranking in a shell script, a CI job or another tool.

`--quiet` prints one title per line, so the next ticket to pick up is:

```bash
$ rw ticket list --project prio-tool --exclude-tag state:done --sort priority --quiet --limit 1
Custom weights
```

`--json` prints `{ total, offset, items }`, ready for `jq`:

```bash
$ rw ticket list --project prio-tool --tag state:backlog --sort priority --json | jq -r '.items[] | "\(.priority) \(.title)"'
2.33 Filters and sorting
1.62 API access
0.85 Priority matrix view
```

`ticket list` and `export csv` also write CSV with `--csv`.

---

## Share and Back Up

**Scenario.** You want to show the backlog to people who don't use rewelo, and keep a copy you can restore.

### With Claude Code (MCP)

> **Prompt you can paste into Claude Code:**
>
> *Create the rewelo dashboard for "prio-tool" and save it as dashboard.html. Then export the project as JSON with its history and save it as prio-tool.json.*

Behind the scenes, Claude will call the tools below and write the files they return:

```
mcp tool: report_dashboard { "project": "prio-tool" }
→ "<!doctype html>…"   (a self-contained HTML page)

mcp tool: export_json { "project": "prio-tool", "withHistory": true }
→ { "tickets": [...], "tags": [...], "relations": [...], "weights": { "w1": 3, "w2": 1, "w3": 1, "w4": 2 }, … }
```

To restore, ask Claude to pass the file to `import_json`. For big projects use the CLI, which writes the files itself: MCP results are limited to 5 MB.

### From the command line

```bash
$ rw report dashboard --project prio-tool --output dashboard.html
Dashboard written to /home/you/dashboard.html

$ rw export json --project prio-tool --output prio-tool.json --with-history
Exported to /home/you/prio-tool.json

$ rw import json prio-tool.json --project prio-tool-restored
Created project "prio-tool-restored"
Imported 5 tickets
Created 2 relations
Set the weights to w1=3 w2=1 w3=1 w4=2
```

With `--with-history`, the restored tickets keep their revisions and tag changes, so lead and cycle times survive the round trip.
