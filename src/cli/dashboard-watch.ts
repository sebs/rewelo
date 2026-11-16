import { basename, dirname, extname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { DB } from "../db/connection.js";
import { DataChanges } from "../db/changes.js";
import { renderDashboard } from "../reports/dashboard.js";
import { AppError } from "../errors.js";
import { replaceFile } from "./files.js";

// rw report dashboard --watch: the page is written again whenever the
// database changes, by this or any other process, and on a new day. Next to
// it goes a script file with the version the page shows, which a page open
// in a browser loads every few seconds to know when to reload (see
// reloadScript in reports/dashboard.ts).

/** How often the database is checked for changes */
export const WATCH_INTERVAL_MS = 2000;

/** The version file next to the page: dashboard.html → dashboard.version.js */
export function versionFilePath(htmlPath: string): string {
  return join(dirname(htmlPath), `${basename(htmlPath, extname(htmlPath))}.version.js`);
}

export interface DashboardWatch {
  db: DB;
  project: { id: number; name: string };
  /** The page's path, validated */
  output: string;
  limit?: number;
  /** Ends the watch */
  signal: AbortSignal;
  intervalMs?: number;
  /** After each write of the page */
  written(version: string): void;
}

/** Write the dashboard, then again on every change, until the signal aborts */
export async function watchDashboard(watch: DashboardWatch): Promise<void> {
  const { db, output, signal } = watch;
  const changes = new DataChanges();
  const versionFile = versionFilePath(output);
  let shown: string | undefined;

  const update = async () => {
    const version = await changes.version(db);
    if (version === shown) return;
    // A rename shows in the heading; a deletion ends the watch
    const [project] = await db.all<{ id: number; name: string }>("SELECT id, name FROM projects WHERE id = ?", watch.project.id);
    if (!project) throw new AppError(`Project "${watch.project.name}" was deleted.`);
    const html = await renderDashboard(db, project.id, project.name, {
      generatedAt: new Date().toISOString(),
      limit: watch.limit,
      version,
      reloadFrom: basename(versionFile),
    });
    // The page first: a browser that sees the new version reloads it
    replaceFile(output, html);
    replaceFile(versionFile, `reweloDashboardVersion(${JSON.stringify(version)});\n`);
    shown = version;
    watch.written(version);
  };

  await update();
  while (!signal.aborted) {
    try {
      await sleep(watch.intervalMs ?? WATCH_INTERVAL_MS, undefined, { signal });
    } catch (err) {
      if (signal.aborted) return; // stopped while waiting
      throw err;
    }
    await update();
  }
}
