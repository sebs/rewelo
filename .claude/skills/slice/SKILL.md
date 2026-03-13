---
name: slice
description: Decompose a large ticket into smaller slices with distributed scores
argument-hint: "[project] [ticket-title]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__ticket_create, mcp__rewelo__ticket_update, mcp__rewelo__tag_assign, mcp__rewelo__tag_create, mcp__rewelo__calc_priority
---

# Feature Slicing Assistant

Decompose a large ticket into smaller, deliverable slices in project **$0**.

## Find the ticket

1. Use `ticket_list` for project **$0**
2. Find the ticket matching **$1**
3. Show its current scores: Benefit, Penalty, Estimate, Risk, Priority

## Slicing criteria

A ticket is a candidate for slicing when:
- Estimate >= 8
- Risk >= 5
- Or estimate + risk >= 10

## Guided decomposition

Ask the user to describe what the ticket involves, then propose 2-5 slices following these principles:

1. **Each slice is independently deliverable** — it produces user-visible value on its own
2. **Thin vertical slices** — each touches all layers (UI, logic, data) rather than horizontal layers
3. **Walking skeleton first** — the first slice should be the simplest end-to-end path

## Score distribution

For each proposed slice:
- **Benefit**: Distribute the parent's benefit across slices (does not need to sum exactly — value can be created by slicing)
- **Penalty**: Assign based on what breaks if that specific slice is skipped
- **Estimate**: Score independently (should be lower than parent)
- **Risk**: Score independently (should be lower than parent)

## Output

| Slice | Title | B | P | E | R | Priority |
|-------|-------|---|---|---|---|----------|
| Parent (original) | ... | 13 | 8 | 13 | 8 | 1.0 |
| Slice 1 | ... | 8 | 5 | 3 | 2 | 2.6 |
| Slice 2 | ... | 5 | 3 | 3 | 2 | 1.6 |

Show how the average priority of slices compares to the parent's priority.

## Apply

Ask: "Create these slices as new tickets?" If confirmed:
- Create each slice as a new ticket via `ticket_create`
- Tag slices with `state:backlog` and a shared tag like `epic:<parent-title>`
- Optionally mark the parent as `state:done` or `state:sliced`
