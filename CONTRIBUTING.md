# Contributing

Contributions are welcome. Here's how to get started.

## Setup

```bash
git clone <repo-url>
cd rewelo
npm install
npm run build
npm test
```

## Development

- **Build**: `npm run build` (compiles TypeScript and injects version)
- **Test**: `npm test` (compiles `src` and `test` into `build/` and runs them with Node's built-in test runner, `node --test`)

Tests use in-memory SQLite databases, so no setup is needed beyond `npm install`.

The repository's `.mcp.json` runs the MCP server from this checkout's build (`node dist/index.js serve`), so Claude Code in the repository talks to the code you are working on: run `npm run build` after a change and restart the server (`/mcp`). Its database is `relative-weight.db` in the repository root, which git ignores.

## Project Structure

```
src/
  index.ts      Entry point: the rw command
  cli/          The CLI: commander setup (main.ts), shared options and output, one module per command group
  mcp/          The MCP server (stdio): tools/, resources, prompts, completions, the session and its
                limits, and live/ (change watcher and channel for writes made elsewhere)
  app/          Use cases the CLI and the MCP server share: ticket lists, priorities, tagging, change plans
  domain/       Scores and weights: the Fibonacci scale and weight rules
  calculations/ Priority, weighted priority, relative weights, what-if scenarios
  workflow/     Workflow states (state:wip, state:done) as reports read them
  reports/      Summary, health, group, distribution, times, event log, diff, dashboard, calibration
  transfer/     CSV and JSON export and import (csv/, json/), with the JSON history format
  db/           Database connection and migrations
  projects/     Project storage
  tickets/      Ticket storage
  tags/         Tags, their assignment and the tag change log
  relations/    Ticket relations and their types
  revisions/    Ticket revision history
  weights/      Weight configuration storage
  validation/   Input validation: strings, paths, timestamps
  errors.ts     AppError and ValidationError, and the messages users see for other errors
  text.ts       Name normalisation, space collapsing, cutting text between characters
  config.ts     .rewelo.json lookup
  display-width.ts  Terminal columns a string takes, for aligned tables
  volume.ts     In Docker: whether the database is on a volume (else rw warns it is lost with the container)
test/           Mirror of src/ with *.test.ts files
site/           Website: node site/build.mjs renders it (and the docs) into _site/
features/       Gherkin specifications
.claude/skills/ Claude Code skills, also served as the MCP server's prompts
db/             SQL schema and DBML model
adr/            Architecture decision records
```

## Guidelines

- Write tests for new functionality
- Follow existing code patterns: plain functions and explicit types; a class only for something that holds state over time (the database connection, the MCP session, its rate limiter, change watcher and channel) and for error types
- Keep commits focused -- one logical change per commit
- Run `npm test` before submitting a pull request
- Keep pull requests small and focused -- large PRs will not be reviewed

## Architecture Decisions

See the [adr/](adr/) directory for recorded architecture decisions.

## Reporting Issues

Use GitHub Issues for bugs and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).
