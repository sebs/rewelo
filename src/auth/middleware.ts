import { IncomingMessage, ServerResponse } from "node:http";
import { DB } from "../db/connection.js";
import { verifyToken, hasTokens, TokenScope } from "./repository.js";

export interface AuthResult {
  authenticated: boolean;
  scope?: TokenScope;
}

/**
 * Extract bearer token from Authorization header.
 */
function extractBearer(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

/**
 * Extract token from cookie (for dashboard sessions).
 */
function extractCookie(req: IncomingMessage): string | null {
  const cookies = req.headers["cookie"];
  if (!cookies) return null;
  const match = cookies.match(/(?:^|;\s*)rw_token=([^\s;]+)/);
  return match ? match[1] : null;
}

/**
 * Authenticate a request. Returns scope if valid, or sends 401 and returns null.
 *
 * Auth is skipped entirely when no tokens exist in the DB (backward compatible).
 */
export async function authenticate(
  db: DB,
  req: IncomingMessage,
  res: ServerResponse
): Promise<AuthResult> {
  // If no tokens configured, auth is disabled
  if (!(await hasTokens(db))) {
    return { authenticated: true };
  }

  // Try bearer header first, then cookie
  const raw = extractBearer(req) ?? extractCookie(req);
  if (!raw) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Authentication required" }));
    return { authenticated: false };
  }

  const scope = await verifyToken(db, raw);
  if (!scope) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or expired token" }));
    return { authenticated: false };
  }

  return { authenticated: true, scope };
}

/**
 * Check if a scope allows access to a given project.
 */
export function scopeAllowsProject(scope: TokenScope | undefined, projectId: number): boolean {
  if (!scope) return true; // no auth enabled
  if (scope.projectIds.length === 0) return true; // all projects
  return scope.projectIds.includes(projectId);
}

/**
 * Check if a scope allows write operations.
 */
export function scopeAllowsWrite(scope: TokenScope | undefined): boolean {
  if (!scope) return true; // no auth enabled
  return !scope.readonly;
}
