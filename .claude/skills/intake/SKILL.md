---
name: intake
description: Conduct a stakeholder interview to create scored backlog tickets
argument-hint: "[project]"
allowed-tools: mcp__rewelo__ticket_create, mcp__rewelo__tag_create, mcp__rewelo__tag_assign, mcp__rewelo__project_list, mcp__rewelo__project_create
---

# Stakeholder Intake Interview

Conduct a structured interview to capture stories for project **$0**.

## Setup

1. Check if the project exists via `project_list`. If not, ask the user if you should create it.

## Interview flow

For each story the stakeholder describes, guide them through scoring:

### Step 1: Capture the story
Ask: "What do you need? Describe the feature or change in one sentence."
Create a clear, concise ticket title from their answer.

### Step 2: Score benefit (1-21, Fibonacci)
Ask: "How valuable is this if we build it?"
Anchor: 1 = nice-to-have, 5 = clearly useful, 13 = critical, 21 = existential

### Step 3: Score penalty (1-21, Fibonacci)
Ask: "What happens if we don't build it?"
Anchor: 1 = nothing, 5 = inconvenience, 13 = significant loss, 21 = business failure

### Step 4: Score estimate (1-21, Fibonacci)
Ask: "How much effort do you think this takes?"
Anchor: 1 = hours, 3 = days, 8 = weeks, 21 = months

### Step 5: Score risk (1-21, Fibonacci)
Ask: "How uncertain or complex is this?"
Anchor: 1 = well-understood, 5 = some unknowns, 13 = major unknowns, 21 = research project

### Step 6: Tags
Ask: "Any labels? (e.g. feature:checkout, team:platform)"

## After each story

- Create the ticket using `ticket_create`
- Tag it `state:backlog` and any user-provided tags using `tag_assign`
- Show a summary: title, scores, computed priority
- Ask: "Next story, or are we done?"

## Wrap-up

When done, show all created tickets in a priority-ranked table.
