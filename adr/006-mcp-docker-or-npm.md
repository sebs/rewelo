# ADR-006: MCP Server Runs From the Docker Image or the npm Package

## Status

Accepted. Supersedes [ADR-004](004-mcp-docker-only.md).

## Context

ADR-004 made Docker the only supported way to run the MCP server. Its reasons were a consistent environment, isolation, and native modules that failed to build on some machines (DuckDB, ADR-003).

Since then:

- ADR-005 replaced DuckDB with `node:sqlite`, which is built into Node.js. rewelo has no native modules left, so `npm install -g rewelo` works wherever a supported Node.js runs (`engines`: `>=24`).
- A `.rewelo.json` names the default project for its directory. The server looks for it from its working directory upwards, and inside the container that is `/app`: a server in Docker can never see a project's `.rewelo.json`, and every tool call has to name the project.
- rewelo is listed in the MCP Registry (`server.json`) with both the npm package (`rw serve`) and the container image, and `mcp.md` documents both (see "Without Docker").

## Decision

The MCP server runs either from the published Docker image or with `rw serve` from the npm package. Both are supported.

The Docker image stays the recommended way: it runs with dropped capabilities, a read-only file system and a memory limit, and keeps the database in a named volume.

## Consequences

- `mcp.md` shows the Docker configuration first and the npm package under "Without Docker", with `RW_DB_PATH` to keep the database in a fixed place.
- Without Docker, the server runs with the user's permissions and no memory limit; the database is wherever `RW_DB_PATH` (or the working directory) puts it.
- A server started in a project's directory uses that project's `.rewelo.json`, which the container can't.
- `server.json` lists both packages, and a release publishes both.
- The Dockerfile remains a maintained artifact.
