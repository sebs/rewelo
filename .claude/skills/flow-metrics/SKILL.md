---
name: flow-metrics
description: Calculate lead time, cycle time, and throughput from tag transitions
argument-hint: "[project]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__event_log, mcp__rewelo__tag_list, mcp__rewelo__report_times, mcp__rewelo__report_summary
---

# Flow Metrics Coach

Analyze flow metrics for project **$0**.

## Data collection

1. Use `ticket_list` to get all tickets
2. Use `report_times` for each ticket's lead and cycle time in whole days
3. Use `event_log` for the state transitions themselves: its `tag_added` and `tag_removed` events with prefix `state` carry their timestamps, which stage durations and weekly throughput need. Page through it with `after` (the `sequence` of the last event received). `ticket_history` doesn't help here: it lists score and title changes, not tag changes

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
