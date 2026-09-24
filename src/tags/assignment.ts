import { DB } from "../db/connection.js";
import { Tag } from "./repository.js";
import { AppError } from "../validation/strings.js";

export interface TicketTag {
  ticket_id: number;
  tag_id: number;
  assigned_at: string;
}

/**
 * A prefix works like a field: a ticket holds at most one value per prefix
 * (assigning state:done replaces state:wip). Asking for two values of the
 * same prefix at once is therefore contradictory and rejected up front.
 */
export function assertOneValuePerPrefix(tags: { prefix: string; value: string }[]): void {
  const seen = new Map<string, string>();
  for (const { prefix, value } of tags) {
    const other = seen.get(prefix);
    if (other !== undefined && other !== value) {
      throw new AppError(
        `Tags "${prefix}:${other}" and "${prefix}:${value}" share the prefix "${prefix}"; a ticket holds one value per prefix`
      );
    }
    seen.set(prefix, value);
  }
}

export interface AssignResult {
  /** false if the ticket already had this tag */
  assigned: boolean;
  /** same-prefix tags removed by this assignment, as "prefix:value" */
  replaced: string[];
}

export async function assignTag(
  db: DB,
  ticketId: number,
  tagId: number
): Promise<AssignResult> {
  // Check if already assigned (idempotent)
  const existing = await db.all(
    `SELECT 1 FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
    ticketId,
    tagId
  );
  if (existing.length > 0) return { assigned: false, replaced: [] };

  // Remove any existing tag with the same prefix (exclusive per prefix)
  const samePrefix = await db.all<{ tag_id: number; prefix: string; value: string }>(
    `SELECT tt.tag_id, t.prefix, t.value FROM ticket_tags tt
     JOIN tags t ON t.id = tt.tag_id
     JOIN tags new_tag ON new_tag.id = ?
     WHERE tt.ticket_id = ? AND t.prefix = new_tag.prefix AND tt.tag_id != ?`,
    tagId,
    ticketId,
    tagId
  );
  for (const row of samePrefix) {
    await db.run(
      `DELETE FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
      ticketId,
      row.tag_id
    );
    await db.run(
      `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action) VALUES (?, ?, ?, ?, 'removed')`,
      ticketId,
      row.tag_id,
      row.prefix,
      row.value
    );
  }

  await db.run(
    `INSERT INTO ticket_tags (ticket_id, tag_id) VALUES (?, ?)`,
    ticketId,
    tagId
  );
  await db.run(
    `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action)
     SELECT ?, id, prefix, value, 'added' FROM tags WHERE id = ?`,
    ticketId,
    tagId
  );
  return { assigned: true, replaced: samePrefix.map((r) => `${r.prefix}:${r.value}`) };
}

export async function removeTag(
  db: DB,
  ticketId: number,
  tagId: number
): Promise<boolean> {
  const existing = await db.all(
    `SELECT 1 FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
    ticketId,
    tagId
  );
  if (existing.length === 0) return false;

  await db.run(
    `DELETE FROM ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
    ticketId,
    tagId
  );
  await db.run(
    `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action)
     SELECT ?, id, prefix, value, 'removed' FROM tags WHERE id = ?`,
    ticketId,
    tagId
  );
  return true;
}

export async function getTicketTags(db: DB, ticketId: number): Promise<Tag[]> {
  return db.all<Tag>(
    `SELECT t.* FROM tags t
     JOIN ticket_tags tt ON tt.tag_id = t.id
     WHERE tt.ticket_id = ?
     ORDER BY t.prefix, t.value`,
    ticketId
  );
}

export async function listTicketsByTag(
  db: DB,
  projectId: number,
  tagId: number
): Promise<number[]> {
  const rows = await db.all<{ ticket_id: number }>(
    `SELECT tt.ticket_id FROM ticket_tags tt
     JOIN tickets tk ON tk.id = tt.ticket_id
     WHERE tt.tag_id = ? AND tk.project_id = ?`,
    tagId,
    projectId
  );
  return rows.map((r) => r.ticket_id);
}
