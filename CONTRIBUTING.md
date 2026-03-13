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
- **Test**: `npm test` (runs vitest)
- **Watch**: `npm run test:watch`

Tests use in-memory DuckDB databases, so no setup is needed beyond `npm install`.

## Project Structure

```
src/
  db/           Database connection and migrations
  projects/     Project CRUD
  tickets/      Ticket CRUD
  tags/         Tag management and audit log
  relations/    Ticket relations
  calculations/ Priority, relative weights, time calculations
  weights/      Weight configuration
  validation/   Input validation and error sanitisation
  export/       CSV and JSON export
  import/       CSV and JSON import
  reports/      Summary, health, distribution, dashboard
  backup/       Full backup and restore
  mcp/          MCP server (stdio transport)
  serialization/ Project export/import serialization
test/           Mirror of src/ with *.test.ts files
features/       Gherkin specifications
db/             SQL schema and DBML model
```

## Guidelines

- Write tests for new functionality
- Follow existing code patterns (no classes, plain functions, explicit types)
- Keep commits focused -- one logical change per commit
- Run `npm test` before submitting a pull request

## Architecture Decisions

See the [adr/](adr/) directory for recorded architecture decisions.

## Reporting Issues

Use GitHub Issues for bugs and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).
