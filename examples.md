# rewelo MCP Examples

These examples use the backlog from [`fixtures/stories.csv`](fixtures/stories.csv) — 40 user stories for a prioritization tool, scored on benefit, penalty, estimate, and risk.

---

## Import a Backlog

**Scenario.** You just exported 40 stories from a spreadsheet. You want to import them, organise them by feature area, and figure out which items deliver the most value for the least effort.

### Create a project and import the CSV

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

### Add dependencies

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

mcp tool: relation_create {
  "project": "prio-tool",
  "source": "User feedback tool integration",
  "type": "depends-on",
  "target": "API access"
}
```

Supported relation types:

| Type | Use when... |
|------|-------------|
| `depends-on` | A can't start until B is done |
| `blocks` | A prevents B from starting |
| `relates-to` | Loosely connected, no ordering |
| `splits-into` | A was broken down into B |
| `see-also` | Reference link, no dependency |

---

## Priority with Custom Weights

**Scenario.** Delivering value matters more to you than avoiding penalties, and risk should weigh twice as much as effort.

> **Prompt you can paste into Claude Code:**
>
> *In rewelo project "prio-tool", show me the priorities with benefit weighted 3, penalty 1, estimate 1 and risk 2. If the ranking looks right, keep those weights for the project.*

Behind the scenes, Claude will first try the weights for one call, then store them:

```
mcp tool: calc_priority { "project": "prio-tool", "w1": 3, "w2": 1, "w3": 1, "w4": 2 }
→ [{ "title": "...", "priority": ..., "weighted": ... }, ...]   (sorted by weighted priority)

mcp tool: weight_set    { "project": "prio-tool", "w1": 3, "w2": 1, "w3": 1, "w4": 2 }
```

Weighted priority is `(w1·benefit + w2·penalty) / (w3·estimate + w4·risk)`; see [calculations.md](calculations.md). Each weight is 0 or between 0.01 and 100, and `w3` and `w4` can't both be 0. `weight_reset` goes back to the defaults (all 1.5).

