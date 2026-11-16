---
name: retro-accuracy
description: Compare original estimates against actual outcomes to find scoring biases
argument-hint: "[project]"
allowed-tools: mcp__rewelo__report_estimates, mcp__rewelo__ticket_list, mcp__rewelo__ticket_history, mcp__rewelo__event_log, mcp__rewelo__report_times, mcp__rewelo__calc_priority, mcp__rewelo__tag_list
---

# Retrospective Accuracy Tracker

Analyze estimation accuracy for completed tickets in project **$0**.

## Data collection

1. Use `ticket_list` to get all tickets tagged `state:done` (`ticket_list` returns 100 tickets per call: page with `offset` until you have `total` of them)
2. Use `ticket_history` for each completed ticket to get:
   - Original scores (the first revision holds the scores before the first update; with no revisions, the scores never changed)
   - Final scores (the ticket's current ones)
3. Use `report_times` for cycle time data, and `event_log` (`tag_added`/`tag_removed` events with their timestamps; it returns 50 events per call: start with `after: 0` and pass the last event's `sequence` as `after` until a page is shorter than `limit`) for when tickets entered `state:wip` and `state:done`: `ticket_history` has no tag changes

## Analysis

### Estimate vs. Actual

Start from `report_estimates`: it groups the done tickets by the estimate they had when work started, gives the median and 85th percentile of cycle time per estimate, the rank correlation of estimate and cycle time with a verdict, and how many tickets were re-estimated after work started. Don't recompute these.
- Name the estimates whose tickets took about as long as smaller ones (the medians don't rise with the estimate)
- Identify where estimates consistently under- or over-predict
- When the verdict says estimates don't predict cycle time, say what that means for the ranking: estimate is half of cost in priority

### Risk vs. Actual Rework

Compare original **risk** score against:
- Number of score revisions (indicates scope changes)
- Time spent (proxy for unexpected complexity)

### Scoring drift

For tickets where scores were updated mid-flight:
- Show original vs. final scores
- Calculate average drift per dimension

## Output

### Accuracy table

| Estimate Score | Tickets | Avg Cycle Time | Expected Relative | Actual Relative | Bias |
|---------------|---------|----------------|-------------------|-----------------|------|

### Systematic biases

Identify patterns like:
- "Your team underestimates risk on tickets tagged `feature:api` by an average of 2 points"
- "Benefit scores above 8 correlate with longer-than-expected cycle times"
- "Tickets initially scored estimate:3 take as long as estimate:5 tickets"

### Recommendations

Suggest calibration adjustments:
- "Consider adding +1 to risk scores for API-related tickets"
- "Estimate:3 tickets should probably be scored as 5"
