---
name: flow-metrics
description: Calculate lead time, cycle time, and throughput from tag transitions
argument-hint: "[project]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__ticket_history, mcp__rewelo__tag_list, mcp__rewelo__report_times, mcp__rewelo__report_summary
---

# Flow Metrics Coach

Analyze flow metrics for project **$0**.

## Data collection

1. Use `ticket_list` to get all tickets
2. Use `report_times` to get timing data from state tag transitions
3. For tickets needing detail, use `ticket_history` to trace individual journeys

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
