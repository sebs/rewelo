---
name: flow-metrics
description: Calculate lead time, cycle time, and throughput from tag transitions
argument-hint: "[project]"
allowed-tools: mcp__rewelo__report_flow, mcp__rewelo__ticket_list, mcp__rewelo__event_log, mcp__rewelo__tag_list, mcp__rewelo__report_times, mcp__rewelo__report_summary
---

# Flow Metrics Coach

Analyze flow metrics for project **$0**.

## Data collection

1. Use `report_flow` for the numbers the server computes: tickets done per week (the last week is the current one, so far) and the average per complete week, cycle and lead time as 50th, 85th and 95th percentiles over the tickets done in the window, and the tickets in progress by age, flagged when older than the 85th percentile of cycle time. It covers the last 12 complete weeks; pass `weeks` for another span (0 for all). Don't recompute these from the event log
2. Use `report_times` for each ticket's lead and cycle time in whole days, if you need single tickets
3. Use `event_log` only for stage durations, which `report_flow` doesn't give: its `tag_added` and `tag_removed` events with prefix `state` carry their timestamps. Read it oldest first: start with `after: 0`, then pass the `sequence` of the last event received as `after`, until a page has fewer events than `limit` (default 50). Without `after`, `event_log` returns the newest events first, and paging from there skips everything older. `ticket_history` doesn't help here: it lists score and title changes, not tag changes

## Metrics to calculate

### Lead Time
Time from ticket creation (or `state:backlog` assignment) to `state:done`.

### Cycle Time
Time from `state:wip` to `state:done` (active work only).

### Throughput
Number of tickets reaching `state:done` per week.

### Stage Duration
Average time spent in each `state:` tag value.

## Output

### Summary statistics
- Mean, median, and 85th percentile for lead time and cycle time
- Weekly throughput trend

### Stage breakdown
| Stage | Avg Duration | Median | Tickets Currently |
|-------|-------------|--------|-------------------|

### Bottleneck analysis
Identify the stage with the longest average duration and suggest:
- WIP limits
- Pairing or swarming
- Process changes

### Recommendations
Provide 2-3 actionable suggestions based on the data, e.g.:
- "Tickets spend 4.2 days average in `state:review`. Consider pairing to reduce this."
- "Throughput dropped 30% last week. 5 tickets are stuck in `state:wip`."
