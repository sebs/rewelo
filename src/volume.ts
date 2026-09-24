import { statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

/** Whether a directory is a mount point: on another device than its parent. */
export function isMountPoint(dir: string): boolean {
  try {
    return statSync(dir).dev !== statSync(dirname(resolve(dir))).dev;
  } catch {
    return false;
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
  const dir = resolve(volume);
  if (!resolve(dbPath).startsWith(dir + sep) || isMountPoint(dir)) return;
  console.error(
    `Warning: no volume is mounted at ${dir}, so the database is lost when the container is removed. Mount one, e.g. docker run -v rw-data:${dir} ...`
  );
}
