import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Whether a directory or file is a mount point: on another device than its parent. */
export function isMountPoint(dir: string): boolean {
  try {
    return statSync(dir).dev !== statSync(dirname(resolve(dir))).dev;
  } catch {
    return false;
  }
}

// The real path of a file, or of its directory if it doesn't exist yet
function realPath(path: string): string | undefined {
  try {
    const full = resolve(path);
    return existsSync(full) ? realpathSync(full) : join(realpathSync(dirname(full)), basename(full));
  } catch {
    return undefined;
  }
}

/**
 * Whether a volume holds the database: mounted at `dir` (/data), below it
 * (-v x:/data/sub) or on the file itself (-v ./rw.db:/data/rw.db).
 */
export function mountedBetween(db: string, dir: string, isMount: (path: string) => boolean = isMountPoint): boolean {
  for (let at = existsSync(db) ? db : dirname(db); ; at = dirname(at)) {
    if (isMount(at)) return true;
    if (at === dir || dirname(at) === at) return false;
  }
}

/**
 * The Docker image sets RW_DATA_VOLUME=/data. A database there without a
 * volume mounted is lost when the container is removed (with --read-only it
 * can't be written at all), and nothing said so.
 */
export function warnIfNoVolume(dbPath: string, env: NodeJS.ProcessEnv = process.env): void {
  const volume = env.RW_DATA_VOLUME;
  if (!volume || dbPath === ":memory:") return;
  // Real paths: a database reached through a symbolic link is still inside
  const dir = realPath(volume);
  const db = realPath(dbPath);
  if (!dir || !db) return; // the database can't be opened there anyway
  const rel = relative(dir, db);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return;
  if (mountedBetween(db, dir)) return;
  console.error(
    `Warning: no volume is mounted at ${dir}, so the database is lost when the container is removed. Mount one, e.g. docker run -v rw-data:${dir} ...`
  );
}
