---
name: reprioritize
description: Reassess backlog priorities after a significant event
argument-hint: "[project] [event-description]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__simulate, mcp__rewelo__ticket_update, mcp__rewelo__report_summary
---

# Continuous Reprioritization

Reassess priorities for project **$0** in light of: **$1**

## Procedure

1. Use `ticket_list` to fetch all active tickets (exclude `state:done`) (`ticket_list` returns 100 tickets per call: page with `offset` until you have `total` of them)
2. Analyze the event described by the user
3. Once you have chosen new scores, call `simulate` with them as `changes`: it ranks the open tickets (not `state:done`) by weighted priority with the project's weights, before and after, and returns each ticket's rank and priority in both. That is the **baseline** and the proposal, among the same tickets. Don't take the baseline from `calc_priority`: it ranks done tickets too, so its ranks don't match the active tickets'

## Reassessment

For each ticket, consider whether the event changes:
- **Benefit**: Does the event make this feature more or less valuable?
- **Penalty**: Does the event increase or decrease the cost of not doing this?
- **Estimate**: Does the event change the effort (e.g. new tooling available)?
- **Risk**: Does the event add or remove uncertainty?

## Output

Present a **before/after comparison**:

| Ticket | Old Priority | Old Rank | Suggested Scores (B/P/E/R) | New Priority | New Rank | Change |
|--------|-------------|----------|----------------------------|-------------|----------|--------|

Highlight tickets that moved more than 2 positions.

## Rationale

For each proposed change, explain in one sentence why the event affects that ticket's scores.

## Apply changes

Ask the user: "Apply these score changes?" If confirmed, use `ticket_update` for each changed ticket. Do NOT update without confirmation.
