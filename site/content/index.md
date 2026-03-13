---
title: Rewelo
description: Prioritize your backlog with math, not gut feeling.
---

# Prioritize your backlog with math, not gut feeling.

Rewelo scores tickets on benefit, penalty, estimate, and risk — then calculates relative priority automatically. Use it from the CLI, or let your AI assistant drive it via MCP.

[Get Started](#quickstart) [View on GitHub](https://github.com/sebastianschuermannai/rewelo)

---

## The Problem

Every team has more ideas than capacity. Spreadsheet scoring breaks down. Gut-feel prioritization creates politics. You need a repeatable, transparent method that the whole team can trust.

## How It Works

### 1. Score

Rate each ticket on four dimensions using the Fibonacci scale (1, 2, 3, 5, 8, 13, 21).

| Dimension | Measures |
|-----------|----------|
| **Benefit** | Value gained by implementing the story |
| **Penalty** | Cost of *not* implementing the story |
| **Estimate** | Resources required for implementation |
| **Risk** | Uncertainty or complexity |

### 2. Calculate

The tool computes priority at runtime:

```
Value    = Benefit + Penalty
Cost     = Estimate + Risk
Priority = Value / Cost
```

### 3. Decide

Sort by priority. The highest-value, lowest-cost items float to the top. No arguments, just numbers.

---

## Two Interfaces, One Database

| | CLI | MCP Server |
|---|-----|------------|
| **How** | `rw ticket create ...` | AI assistant calls `ticket_create` |
| **Who** | Scripts, pipelines, humans | Claude, Cursor, any MCP client |
| **Where** | Local or Docker | Docker (stdio transport) |

Both read and write the same DuckDB database.

---

## Features

- **Relative Weight Method** — Industry-standard prioritization formula, not another proprietary score.
- **Tags, Not Fields** — Flexible `prefix:value` tags replace rigid status columns. Model any workflow.
- **Full Audit Trail** — Every score change, tag assignment, and removal is tracked with timestamps.
- **Multi-Project** — Run one instance for multiple teams or products, each fully isolated.
- **Flow Metrics** — Lead time, cycle time, and throughput calculated from tag transitions.
- **HTML Dashboard** — One command generates a self-contained report you can share.
- **Ticket Relations** — blocks, depends-on, relates-to — model real dependencies.
- **Backup & Restore** — Full JSON export/import. No lock-in.
- **Docker-First** — Non-root container, read-only filesystem, capped memory.

---

## Quickstart

```bash
# Create a project and add a ticket
docker run --rm -v rw-data:/data rewelo-mcp project create "My Project"
docker run --rm -v rw-data:/data rewelo-mcp ticket create 1 "Build login page" -b 8 -p 5 -e 3 -r 2

# Calculate priorities
docker run --rm -v rw-data:/data rewelo-mcp calc weights 1
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "rewelo": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i", "--init",
        "--cap-drop=ALL", "-v", "rw-data:/data",
        "rewelo-mcp", "serve"
      ]
    }
  }
}
```

---

## For AI-Assisted Teams

> "Hey Claude, create a ticket for the checkout redesign, score it 8/5/3/2, tag it feature:checkout and state:backlog."

The MCP server exposes 30+ tools that let AI assistants create projects, manage tickets, run calculations, generate reports, and conduct stakeholder interviews — all through natural conversation.

---

## Trust & Security

- Non-root container, all capabilities dropped
- Read-only filesystem (only `/data` is writable)
- 256 MB memory cap
- MIT licensed, SBOM included in every release
- Full revision history — nothing is silently overwritten

---

MIT License · [GitHub](https://github.com/sebastianschuermannai/rewelo) · [Documentation](https://github.com/sebastianschuermannai/rewelo/blob/main/mcp.md) · [CLI Reference](https://github.com/sebastianschuermannai/rewelo/blob/main/cli.md) · [Changelog](https://github.com/sebastianschuermannai/rewelo/blob/main/CHANGELOG.md)
