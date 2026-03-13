# Changelog

## 0.3.3

- Multi-arch Docker builds (linux/amd64, linux/arm64) in release pipeline
- CycloneDX SBOM generated and attached to every GitHub Release
- SBOM attestation support (commented out until repo is public)
- GitHub Actions hardened: commit SHA pinning, timeout-minutes, persist-credentials disabled
- Dependabot configured for GitHub Actions and npm dependency updates
- Project homepage with WebGL background and markdown-based build system

## 0.3.1

- CI pipeline: build, type check, test on Node 22 with Docker smoke test
- Release pipeline: automated GitHub Releases on version tags with npm tarball and Docker image
- Project renamed from `relative-weight-cli` to `backlog-mcp` (later renamed to `rewelo`)
- Documentation updated for open-source release (README, CLI, MCP references)
- Added LICENSE (MIT), SECURITY.md, CONTRIBUTING.md
- Added CHANGELOG from git history

## 0.3.0

- HTML dashboard report with priority tables, score distributions, health indicators, and interactive dependency graph
- Event log: unified chronological feed of ticket creations, score changes, and tag changes
- Project diff: compare current state against a point in time
- Bug fixes for error message sanitisation

## 0.2.1

- Bug fixes

## 0.2.0

- Ticket relations (blocks, depends-on, relates-to, and more)
- Full backup and restore across all projects
- Configurable weight parameters (w1-w4) per project
- Tag rename with audit trail
- MCP tools for relations, weights, backup/restore, and tag rename

## 0.1.2

- Versioning improvements

## 0.1.1

- Docker container support with security hardening (non-root user, read-only filesystem, dropped capabilities)
- MCP server over stdio transport
- Server version tool
- CLI documentation

## 0.1.0

- Initial release
- Projects, tickets, tags with full CRUD
- Fibonacci scoring (benefit, penalty, estimate, risk)
- Priority and relative weight calculations
- Tag audit log with lead time and cycle time
- Ticket revision history
- CSV and JSON export/import
- Reports: summary, group, distribution, health, times
