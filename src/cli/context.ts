import { existsSync } from "fs";
import { DB } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import { getProjectByName, Project } from "../projects/repository.js";
import { AppError, ValidationError } from "../errors.js";
import { validateDbPath } from "../validation/paths.js";
import { warnIfNoVolume } from "../volume.js";
import { loadConfig } from "../config.js";

// Errors here and in the commands are thrown: main.ts prints the message and
// exits with 1, after the database is closed.

/** The global options, as cmd.optsWithGlobals() returns them */
export interface GlobalOptions {
  db?: string;
  json?: boolean;
  csv?: boolean;
  quiet?: boolean;
}

const DEFAULT_DB = "./relative-weight.db";

// An empty or blank RW_DB_PATH (e.g. `RW_DB_PATH= rw …`) counts as unset.
// A path from the variable is named as such when it is rejected.
export function resolveDbPath(opts: { db?: string }): string {
  const fromEnv = process.env.RW_DB_PATH?.trim() || undefined;
  const path = opts.db ?? fromEnv ?? DEFAULT_DB;
  try {
    return validateDbPath(path);
  } catch (err) {
    if (err instanceof ValidationError && opts.db === undefined && fromEnv !== undefined) {
      throw new ValidationError(`RW_DB_PATH=${fromEnv}: ${err.message}`);
    }
    throw err;
  }
}

export async function withDb<T>(
  opts: { db?: string },
  fn: (db: DB) => Promise<T>,
  { create = false }: { create?: boolean } = {}
): Promise<T> {
  const dbPath = resolveDbPath(opts);
  // Only commands that add data create the database: a mistyped --db for
  // e.g. project list used to leave a new empty database behind
  if (!create && dbPath !== ":memory:" && !existsSync(dbPath)) {
    throw new AppError(`Database ${dbPath} does not exist. Create a project first (rw project create <name>), or check --db / RW_DB_PATH.`);
  }
  warnIfNoVolume(dbPath);
  const db = await DB.open(dbPath);
  try {
    await migrate(db);
    return await fn(db);
  } finally {
    await db.close();
  }
}

// Fall back to the "project" field of the nearest .rewelo.json when --project
// is omitted, matching the MCP server's behaviour.
export function resolveProjectName(projectName: string | undefined): string {
  // An explicit but blank --project is a mistake, not a request for the default
  if (projectName !== undefined && projectName.trim() === "") {
    throw new AppError("--project must not be empty");
  }
  const name = projectName ?? loadConfig().project;
  if (!name) {
    throw new AppError('No project specified. Pass --project or add a .rewelo.json with a "project" field.');
  }
  return name;
}

export async function withProject<T>(
  opts: { db?: string },
  projectName: string | undefined,
  fn: (db: DB, project: Project) => Promise<T>
): Promise<T> {
  const name = resolveProjectName(projectName);
  return withDb(opts, async (db) => {
    const project = await getProjectByName(db, name);
    if (!project) throw new AppError(`Project "${name}" not found`);
    return fn(db, project);
  });
}
