---
name: plan-sprint
description: Propose a sprint backlog from prioritized tickets based on team capacity
argument-hint: "[project] [capacity-points]"
allowed-tools: mcp__rewelo__plan_capacity, mcp__rewelo__calc_priority, mcp__rewelo__weight_get, mcp__rewelo__ticket_list, mcp__rewelo__tag_assign, mcp__rewelo__tag_create
---

# Sprint Planning Copilot

Plan a sprint for project **$0** with a capacity of **$1** effort points (default: 20 if not provided).

## Selection

Call `plan_capacity` once, with the capacity, `effort: "cost"` (a ticket takes estimate + risk) and `excludeTags: ["state:wip"]` (work already under way isn't planned again). The server does the selection; don't recalculate it:

- It walks the open tickets (not `state:done`) by weighted priority, under the project's weights
- Each ticket comes with its open blockers (`blocks`, `depends-on`, transitively), scheduled before it. A pulled-in blocker has `for`: the tickets it was pulled in for, and `rank: null` when it lies outside the ranking (for example a blocker already tagged `state:wip`)
- A ticket whose blockers don't fit together with it is skipped, blockers and all; filling goes on with smaller tickets further down
- `tickets` is the plan in the order to work on it; `skipped` lists the higher-ranked tickets that didn't fit, with `needs`: their effort together with their unplanned blockers

Then call `weight_get` for the weights that drove the ranking, and `ticket_list` (page with `offset` until you have `total`) for the benefit and penalty of the planned tickets.

## Output

### Sprint backlog

| # | Ticket | Rank | Weighted Priority | Cost (E+R) | Cumulative | Pulled in for |
|---|--------|------|-------------------|------------|------------|---------------|

From `tickets`, in their order. "Pulled in for" is `for`; leave it empty for tickets selected on their own merit.

### Sprint summary

- **Total value** (sum of benefit + penalty for the planned tickets)
- **Total weighted priority** (sum of weighted priorities)
- **Remaining capacity** (`remaining`)
- **First ticket cut**: the first of `skipped`, and what including it would cost (`needs`)
- **Trade-off analysis**: whether swapping the lowest-priority planned ticket for a skipped one would improve total value

### Dependency warnings

For each skipped ticket whose `needs` is larger than its own effort, its blockers made it too big: name them (`calc_priority` lists a ticket's open blockers as `blockedBy`) and explain what would need to happen to unblock it.

### Weight configuration used

Show the w1–w4 values that drove the ranking, so the team knows how priorities were calculated. If all defaults (1.5), note that custom weights could be set to tune the ranking.

## Optional

If the user confirms, tag the planned tickets with a tag for this sprint, e.g. `sprint:2026-w39`, using `tag_assign`. Sprint membership gets its own prefix: a ticket holds one value per prefix, so a `state:` value for it would be replaced as soon as work on the ticket starts (`state:wip`) or ends (`state:done`).
