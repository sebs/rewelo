---
name: what-if
description: Simulate priority changes without modifying real data
argument-hint: "[project]"
allowed-tools: mcp__rewelo__ticket_list, mcp__rewelo__calc_priority, mcp__rewelo__simulate, mcp__rewelo__explain_priority, mcp__rewelo__report_summary, mcp__rewelo__ticket_update
---

# What-If Scenario Simulation

Explore prioritization scenarios for project **$0** without changing real data.

## Setup

1. Use `ticket_list` and `calc_priority` to get the current baseline ranking (`ticket_list` returns 100 tickets per call: page with `offset` until you have `total` of them)
2. Store this as the **baseline** for comparison

## Interactive loop

Ask the user: "What scenario do you want to explore?"

Examples:
- "What if we drop the estimate on ticket X from 8 to 3?"
- "What if the penalty on compliance doubles?"
- "What if we remove ticket Y entirely?"
- "What if we add a new ticket with B=13, P=8, E=5, R=3?"

## For each scenario

1. Call `simulate` with the hypothetical change: `changes` for new scores of existing tickets, `add` for new tickets, `remove` for dropped ones, `weights` for other weights. It writes nothing (do NOT call `ticket_update`).
2. Don't recalculate priorities yourself: `simulate` returns the ranks and priorities before and after, and `rankChange` for every ticket that moved.
3. For "what would it take for X to reach the top N?", call `explain_priority` with `title` and `top`: it shows the formula and the smallest single score change that gets there.

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
