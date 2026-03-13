---
name: standup
description: Generate a daily standup digest with progress, blockers, and sprint health
argument-hint: "[project]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__ticket_history, mcp__rewelo__report_times, mcp__rewelo__report_summary, mcp__rewelo__calc_priority, mcp__rewelo__tag_list
---

# Daily Standup Digest

Generate a standup summary for project **$0**.

## Data collection

1. Use `ticket_list` to get all tickets with their current tags
2. Use `report_times` for recent transitions
3. Use `ticket_history` for tickets that changed recently

## Sections

### Done (since last standup)
Tickets that transitioned to `state:done` in the last 24 hours.
Show: title, cycle time, priority score.

### In Progress
Tickets currently tagged `state:wip`.
Show: title, how long in WIP, priority score.
Flag any ticket in WIP for more than 3 days.

### Blocked
Tickets tagged `state:blocked` (if tag exists).
Show: title, how long blocked, priority score.

### Up Next
Top 3 tickets from `state:backlog` by priority that would fit remaining capacity.

## Sprint Health (if applicable)

If tickets are tagged `state:sprint`:
- Total sprint tickets vs. completed
- Priority-weighted progress: sum of (priority * done) / sum of priority for all sprint tickets
- Projected completion based on current throughput

## Output format

Keep it concise — this is a standup, not a report:

```
## Standup — Project Alpha — 2024-01-15

### Done (2)
- Login page redesign (3.2 priority, 2d cycle time)
- Fix password reset bug (4.1 priority, 0.5d cycle time)

### In Progress (3)
- Checkout flow (1.8 priority, 1d in WIP)
- API rate limiting (2.5 priority, 4d in WIP) ⚠️
- User dashboard (1.2 priority, 1d in WIP)

### Up Next
- Email notifications (3.0 priority, cost: 5)
- Export to CSV (2.1 priority, cost: 3)

### Sprint: 5/12 done (42%) | 60% by priority-weight
```
