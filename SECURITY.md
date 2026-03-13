# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainer directly. You can find contact information in the repository's GitHub profile.

Include:

- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any suggested fix (optional)

You should receive a response within 7 days. If the vulnerability is confirmed, a fix will be released as soon as possible.

## Scope

The following are in scope:

- SQL injection or query manipulation
- Path traversal in database file or export paths
- Denial of service through crafted input
- Information leakage through error messages
- Container escape or privilege escalation (Docker deployment)
- MCP server input validation bypasses

## Security Design

- All database queries use parameterised statements
- Input validation on all user-facing boundaries (CLI arguments, MCP tool parameters)
- Error messages are sanitised to never expose SQL, file paths, or stack traces
- The Docker container runs as a non-root user with dropped capabilities, a read-only filesystem, and memory limits
