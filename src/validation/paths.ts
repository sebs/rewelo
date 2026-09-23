/**
 * Path validation for database file and export/import paths.
 * Prevents path traversal and access to sensitive locations.
 */

import { resolve, extname, dirname } from "path";
import { lstatSync, statSync, realpathSync } from "fs";
import { ValidationError } from "./strings.js";

export function validateDbPath(dbPath: string): string {
  if (dbPath === ":memory:") return dbPath;

  if (dbPath.includes("\0")) {
    throw new ValidationError("Database path must not contain null bytes");
  }

  const resolved = resolve(dbPath);

  if (extname(resolved) === ".duckdb") {
    throw new ValidationError(
      "DuckDB databases are no longer supported. Export your projects with rewelo 0.4.x (rw export json) and import them into a .db file"
    );
  }

  if (extname(resolved) !== ".db") {
    throw new ValidationError("Database file must have .db extension");
  }

  return resolved;
}

export function validateExportPath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new ValidationError("File path must not contain null bytes");
  }

  const resolved = resolve(filePath);
  const allowed = [".json", ".csv", ".html"];
  const ext = extname(resolved).toLowerCase();

  if (!allowed.includes(ext)) {
    throw new ValidationError(
      `Export file must have one of these extensions: ${allowed.join(", ")}`
    );
  }

  // Never write through a symlink: it could point anywhere (security.feature)
  let existing;
  try {
    existing = lstatSync(resolved);
  } catch {
    existing = undefined;
  }
  if (existing?.isSymbolicLink()) {
    throw new ValidationError("Export path must not be a symbolic link");
  }
  if (existing && !existing.isFile()) {
    throw new ValidationError("Export path must be a regular file");
  }

  let parentIsDir = false;
  try {
    parentIsDir = statSync(dirname(resolved)).isDirectory();
  } catch {
    parentIsDir = false;
  }
  if (!parentIsDir) {
    throw new ValidationError("Export directory does not exist");
  }

  return resolved;
}

export function validateImportPath(filePath: string, allowed: string[] = [".json", ".csv"]): string {
  if (filePath.includes("\0")) {
    throw new ValidationError("File path must not contain null bytes");
  }

  const resolved = resolve(filePath);

  // Resolve symlinks and check the real path
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    throw new ValidationError("Import file does not exist or is not accessible");
  }

  // Must be a regular file
  try {
    const stat = statSync(real);
    if (!stat.isFile()) {
      throw new ValidationError("Import path must be a regular file");
    }
  } catch (e) {
    if (e instanceof ValidationError) throw e;
    throw new ValidationError("Import file does not exist or is not accessible");
  }

  const ext = extname(real).toLowerCase();
  if (!allowed.includes(ext)) {
    throw new ValidationError(
      `Import file must have one of these extensions: ${allowed.join(", ")}`
    );
  }

  return real;
}
