---
name: what-if
description: Simulate priority changes without modifying real data
argument-hint: "[project]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__calc_priority, mcp__rewelo__report_summary, mcp__rewelo__ticket_update
---

# What-If Scenario Simulation

Explore prioritization scenarios for project **$0** without changing real data.

## Setup

1. Use `ticket_list` and `calc_priority` to get the current baseline ranking
2. Store this as the **baseline** for comparison

## Interactive loop

Ask the user: "What scenario do you want to explore?"

Examples:
- "What if we drop the estimate on ticket X from 8 to 3?"
- "What if the penalty on compliance doubles?"
- "What if we remove ticket Y entirely?"
- "What if we add a new ticket with B=13, P=8, E=5, R=3?"

## For each scenario

1. Take the baseline data
2. Apply the hypothetical change **in memory only** (do NOT call `ticket_update`)
3. Recalculate priorities using the relative weight formula:
   - Value = Benefit + Penalty
   - Cost = Estimate + Risk
   - Priority = Value / Cost
4. Compare against baseline

## Output

### Ranking diff

| Ticket | Baseline Rank | Scenario Rank | Change | Priority Delta |
|--------|--------------|---------------|--------|----------------|

Highlight:
- Tickets that moved up or down by 2+ positions
- The ticket(s) directly affected by the scenario
- Any ticket that changed from "in sprint" to "out" or vice versa

### Impact summary

- "Reducing estimate on X from 8 to 3 moves it from #7 to #2, displacing Y and Z"
- "Doubling penalty on compliance tickets reshuffles the top 5"

## Continue or apply

After showing results, ask:
- "Try another scenario?" → loop back
- "Apply this change for real?" → only then use `ticket_update`
- "Done" → show final baseline vs. all explored scenarios side by side
