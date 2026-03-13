---
name: portfolio
description: Cross-project portfolio view comparing value distribution and effort allocation
allowed-tools: mcp__rewelo__project_list, mcp__rewelo__ticket_list, mcp__rewelo__calc_priority, mcp__rewelo__report_summary
---

# Multi-Project Portfolio View

Generate a cross-project portfolio analysis.

## Data collection

1. Use `project_list` to get all projects
2. For each project, use `ticket_list` and `calc_priority` to get tickets and priorities
3. Use `report_summary` for each project

## Portfolio metrics

For each project, calculate:
- **Total Value**: sum of (benefit + penalty) across active tickets
- **Total Cost**: sum of (estimate + risk) across active tickets
- **Average Priority**: mean priority score
- **Ticket Count**: total active tickets
- **Completion Rate**: tickets tagged `state:done` / total tickets

## Output

### Project comparison table

| Project | Tickets | Total Value | Total Cost | Avg Priority | Done % |
|---------|---------|-------------|------------|-------------|--------|

### Value vs. Cost chart (text-based)

Show a simple bar comparison for each project:
```
ProjectA: Value ████████████ 120  Cost ██████ 60
ProjectB: Value ████ 40         Cost ████████ 80
```

### Imbalance analysis

Identify projects where:
- High value but low effort allocated (under-invested)
- Low value but high effort allocated (over-invested)
- High average priority (urgent backlog)
- Low completion rate (execution problems)

### Recommendations

Suggest rebalancing actions:
- "Project Alpha has 60% of total value but only 30% of effort. Consider shifting resources."
- "Project Beta has low value and high cost. Evaluate whether to continue or descope."
