/**
 * Path validation for database file and export/import paths.
 * Prevents path traversal and access to sensitive locations.
 */

import { resolve, extname, dirname } from "path";
import { lstatSync, statSync, realpathSync } from "fs";
import { ValidationError } from "./strings.js";

// resolve() is lexical: "file.json/../x.json" and "missing/../x.db" resolve
// to "x.json" and "x.db" although the OS would refuse them (ENOTDIR/ENOENT),
// and "x.json/" loses its trailing slash. Check the path as written.
function assertParentAsWritten(filePath: string, what: string): void {
  if (/[\\/]$/.test(filePath)) {
    throw new ValidationError(`${what} path must name a file, not end in a slash`);
  }
  let isDir = false;
  try {
    isDir = statSync(dirname(filePath)).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new ValidationError(`${what} directory does not exist`);
}

export function validateDbPath(dbPath: string): string {
  if (dbPath === ":memory:") return dbPath;

  if (dbPath.includes("\0")) {
    throw new ValidationError("Database path must not contain null bytes");
  }

  const resolved = resolve(dbPath);
  const ext = extname(resolved).toLowerCase();

  if (ext === ".duckdb") {
    throw new ValidationError(
      `DuckDB databases are no longer supported. Export each project with the last DuckDB release, rewelo 0.4.2 (rw export json):\n` +
        `  npx rewelo@0.4.2 --db ${dbPath} export json --project <name> --output <name>.json\n` +
        `then import it into a .db file:\n` +
        `  rw import json <name>.json --project <name>`
    );
  }

  if (ext !== ".db") {
    throw new ValidationError("Database file must have .db extension");
  }
  assertParentAsWritten(dbPath, "Database");

  // A symlink could make us create or overwrite an arbitrary file: only
  // follow it to an existing regular .db file (security.feature).
  let link;
  try {
    link = lstatSync(resolved);
  } catch {
    link = undefined;
  }
  if (link?.isSymbolicLink()) {
    let target: string | undefined;
    try {
      target = realpathSync(resolved);
    } catch {
      target = undefined;
    }
    if (!target || extname(target).toLowerCase() !== ".db" || !statSync(target).isFile()) {
      throw new ValidationError("Database path resolves to a disallowed location");
    }
  }

  return resolved;
}

export function validateExportPath(filePath: string, allowed: string[] = [".json", ".csv", ".html"]): string {
  if (filePath.includes("\0")) {
    throw new ValidationError("File path must not contain null bytes");
  }

  const resolved = resolve(filePath);
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

  assertParentAsWritten(filePath, "Export");

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
