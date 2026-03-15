---
name: plan-sprint
description: Propose a sprint backlog from prioritized tickets based on team capacity
argument-hint: "[project] [capacity-points]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__calc_priority, mcp__rewelo__weight_get, mcp__rewelo__tag_list, mcp__rewelo__tag_assign, mcp__rewelo__tag_create, mcp__rewelo__report_summary, mcp__rewelo__relation_list_all
---

# Sprint Planning Copilot

Plan a sprint for project **$0** with a capacity of **$1** effort points (default: 20 if not provided).

## Procedure

1. Use `ticket_list` to fetch all tickets in the project
2. Use `weight_get` to read the project's stored weight configuration
3. Use `calc_priority` (with the project weights) to get the weighted priority ranking
4. Filter to tickets tagged `state:backlog` (exclude `state:wip`, `state:done`)
5. Sort by weighted priority (highest first)

## Dependency analysis

Before selection, build a dependency graph in a single call:

1. Call `relation_list_all` once to get every relation in the project
2. Filter to `blocks` / `depends-on` / `is-blocked-by` / `is-depended-on-by` relation types
3. Build a map: `ticket → set of tickets it depends on`

A ticket is **eligible** only when all of its dependencies are either:
- Already tagged `state:done`, OR
- Already selected earlier in the current sprint plan

## Sprint selection

Walk the priority-sorted candidates. For each ticket:

1. Check eligibility (all dependencies satisfied per rules above)
2. If eligible and fits within remaining capacity (`estimate + risk`), select it
3. If **not eligible** because a dependency is also a candidate, try to pull the dependency in first (if it fits). This lets a high-value ticket pull its blocker into the sprint.
4. If not eligible and the dependency is not a candidate (e.g. not in backlog), skip and flag it

Continue until capacity is exhausted or no more eligible tickets remain.

## Output

### Sprint backlog

| # | Ticket | Weighted Priority | Cost (E+R) | Cumulative | Pulled by |
|---|--------|-------------------|------------|------------|-----------|

The "Pulled by" column shows which higher-priority ticket caused a dependency to be included ahead of its natural rank. Leave empty for tickets selected on their own merit.

### Sprint summary

- **Total value** (sum of benefit + penalty for selected tickets)
- **Total weighted priority** (sum of weighted priorities)
- **Remaining capacity** (if any)
- **First ticket cut** and what including it would cost
- **Trade-off analysis**: if swapping the lowest-priority selected ticket for a smaller unselected ticket would improve total value

### Dependency warnings

List any tickets that were **skipped due to unresolved dependencies**:

| Ticket | Priority | Blocked by | Blocker state |
|--------|----------|------------|---------------|

Explain what would need to happen to unblock each one.

### Weight configuration used

Show the w1–w4 values that drove the ranking, so the team knows how priorities were calculated. If all defaults (1.5), note that custom weights could be set to tune the ranking.

## Optional

If the user confirms, tag selected tickets with `state:sprint` using `tag_assign` (create the tag first if it does not exist).
