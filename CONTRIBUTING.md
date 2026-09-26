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
  db/           Database connection and migrations
  projects/     Project CRUD
  tickets/      Ticket CRUD
  tags/         Tag management and audit log
  relations/    Ticket relations
  revisions/    Ticket revision history
  calculations/ Priority, relative weights, time calculations
  weights/      Weight configuration
  validation/   Input validation and error sanitisation
  export/       CSV and JSON export
  import/       CSV and JSON import
  reports/      Summary, health, distribution, dashboard
  mcp/          MCP server (stdio transport)
  serialization/ Project export/import serialization
test/           Mirror of src/ with *.test.ts files
site/           Website: node site/build.mjs renders it (and the docs) into _site/
features/       Gherkin specifications
.claude/skills/ Claude Code skills, also served as the MCP server's prompts
db/             SQL schema and DBML model
```

## Guidelines

- Write tests for new functionality
- Follow existing code patterns (no classes, plain functions, explicit types)
- Keep commits focused -- one logical change per commit
- Run `npm test` before submitting a pull request
- Keep pull requests small and focused -- large PRs will not be reviewed

## Architecture Decisions

See the [adr/](adr/) directory for recorded architecture decisions.

## Reporting Issues

Use GitHub Issues for bugs and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).
