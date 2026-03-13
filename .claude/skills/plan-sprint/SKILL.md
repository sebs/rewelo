---
name: plan-sprint
description: Propose a sprint backlog from prioritized tickets based on team capacity
argument-hint: "[project] [capacity-points]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__calc_priority, mcp__rewelo__tag_list, mcp__rewelo__tag_assign, mcp__rewelo__report_summary
---

# Sprint Planning Copilot

Plan a sprint for project **$0** with a capacity of **$1** effort points (default: 20 if not provided).

## Procedure

1. Use `ticket_list` to fetch all tickets in the project
2. Use `calc_priority` to get the current priority ranking
3. Filter to tickets tagged `state:backlog` (exclude `state:wip`, `state:done`)
4. Sort by priority (highest first)

## Sprint selection

Greedily fill the sprint by adding tickets in priority order until the capacity is exhausted. Use `estimate + risk` as the cost of each ticket.

## Output

Present a table:

| # | Ticket | Priority | Cost (E+R) | Cumulative |
|---|--------|----------|------------|------------|

Then show:
- **Total value** (sum of benefit + penalty for selected tickets)
- **Remaining capacity** (if any)
- **First ticket cut** and what including it would cost
- **Trade-off analysis**: if swapping the lowest-priority selected ticket for a smaller unselected ticket would improve total value

## Optional

If the user confirms, tag selected tickets with `state:sprint` using `tag_assign`.
