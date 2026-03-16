import { randomBytes, createHash } from "node:crypto";
import { DB } from "../db/connection.js";

export interface Token {
  id: number;
  label: string;
  readonly: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface TokenScope {
  projectIds: number[];  // empty = all projects
  readonly: boolean;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateToken(): string {
  return "rw_" + randomBytes(24).toString("base64url");
}

/**
 * Create a new token. Returns the raw token string (shown once, never stored).
 */
export async function createToken(
  db: DB,
  label: string,
  options: { readonly?: boolean; projectIds?: number[]; expiresInDays?: number }
): Promise<string> {
  const raw = generateToken();
  const hash = hashToken(raw);

  const expiresAt = options.expiresInDays
    ? new Date(Date.now() + options.expiresInDays * 86400000).toISOString()
    : null;

  await db.run(
    `INSERT INTO rw.tokens (token_hash, label, readonly, expires_at) VALUES (?, ?, ?, ?)`,
    hash,
    label,
    options.readonly ?? false,
    expiresAt
  );

  // Get the inserted token ID
  const rows = await db.all<{ id: number }>(
    `SELECT id FROM rw.tokens WHERE token_hash = ?`,
    hash
  );
  const tokenId = rows[0].id;

  // Scope to projects if specified
  if (options.projectIds && options.projectIds.length > 0) {
    for (const pid of options.projectIds) {
      await db.run(
        `INSERT INTO rw.token_projects (token_id, project_id) VALUES (?, ?)`,
        tokenId,
        pid
      );
    }
  }

  return raw;
}

/**
 * List all tokens (without hashes).
 */
export async function listTokens(db: DB): Promise<Array<Token & { projects: string[] }>> {
  const tokens = await db.all<Token>(
    `SELECT id, label, readonly, expires_at, created_at FROM rw.tokens ORDER BY created_at DESC`
  );

  const result = [];
  for (const t of tokens) {
    const projects = await db.all<{ name: string }>(
      `SELECT p.name FROM rw.token_projects tp
       JOIN rw.projects p ON p.id = tp.project_id
       WHERE tp.token_id = ?`,
      t.id
    );
    result.push({
      ...t,
      projects: projects.map((p) => p.name),
    });
  }
  return result;
}

/**
 * Revoke a token by label.
 */
export async function revokeToken(db: DB, label: string): Promise<boolean> {
  const rows = await db.all<{ id: number }>(
    `SELECT id FROM rw.tokens WHERE label = ?`,
    label
  );
  if (rows.length === 0) return false;

  const tokenId = rows[0].id;
  await db.run(`DELETE FROM rw.token_projects WHERE token_id = ?`, tokenId);
  await db.run(`DELETE FROM rw.tokens WHERE id = ?`, tokenId);
  return true;
}

/**
 * Verify a raw bearer token. Returns the scope if valid, null if invalid/expired.
 */
export async function verifyToken(db: DB, raw: string): Promise<TokenScope | null> {
  const hash = hashToken(raw);

  const rows = await db.all<{ id: number; readonly: boolean; expires_at: string | null }>(
    `SELECT id, readonly, expires_at FROM rw.tokens WHERE token_hash = ?`,
    hash
  );
  if (rows.length === 0) return null;

  const token = rows[0];

  // Check expiry
  if (token.expires_at) {
    const expires = new Date(token.expires_at).getTime();
    if (Date.now() > expires) return null;
  }

  // Get scoped projects
  const projects = await db.all<{ project_id: number }>(
    `SELECT project_id FROM rw.token_projects WHERE token_id = ?`,
    token.id
  );

  return {
    projectIds: projects.map((p) => p.project_id),
    readonly: token.readonly,
  };
}

/**
 * Check if any tokens exist in the database.
 */
export async function hasTokens(db: DB): Promise<boolean> {
  const rows = await db.all<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM rw.tokens`
  );
  return rows[0].cnt > 0;
}
