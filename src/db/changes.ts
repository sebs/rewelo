import { randomUUID } from "node:crypto";
import type { DB } from "./connection.js";

/**
 * A token that changes whenever what a report shows may have: when another
 * connection commits (PRAGMA data_version), when this one changes rows
 * (total_changes(), as data_version misses a connection's own commits), and
 * when the UTC day changes, as the cumulative flow ends today. Reading it
 * costs one query, so a live dashboard can ask often and render only when
 * it changed.
 *
 * It covers the whole database, not one project: a change to another
 * project, or a dry run that was rolled back, renders a dashboard again for
 * nothing. A restarted process starts a new run, so its tokens never repeat
 * an earlier one's.
 */
export class DataChanges {
  private readonly run = randomUUID().slice(0, 8);
  private generation = 0;
  private seen: string | undefined;

  async version(db: DB, now: Date = new Date()): Promise<string> {
    const [{ data_version, total_changes }] = await db.all<{ data_version: number; total_changes: number }>(
      "SELECT data_version, total_changes() AS total_changes FROM pragma_data_version"
    );
    const state = `${data_version}/${total_changes}`;
    if (this.seen !== undefined && state !== this.seen) this.generation++;
    this.seen = state;
    return `${this.run}.${this.generation}.${now.toISOString().slice(0, 10)}`;
  }
}
