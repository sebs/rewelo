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

/**
 * A ticket holds one value per prefix, so it never needs many tags. Every
 * assignment checks all of a ticket's tags for its prefix, so without a cap
 * one imported ticket with 20,000 tags took 16 s and blocked the MCP server.
 */
export const MAX_TAGS_PER_TICKET = 100;

export interface AssignResult {
  /** false if the ticket already had this tag */
  assigned: boolean;
  /** same-prefix tags removed by this assignment, as "prefix:value" */
  replaced: string[];
}

async function assertTicketExists(db: DB, ticketId: number): Promise<void> {
  const rows = await db.all(`SELECT 1 FROM tickets WHERE id = ?`, ticketId);
  if (rows.length === 0) throw new AppError("Ticket not found (it may just have been deleted)");
}

export async function assignTag(
  db: DB,
  ticketId: number,
  tagId: number
): Promise<AssignResult> {
  // One write transaction: in parallel processes the same-prefix check and
  // the insert interleaved and left a ticket with several state: tags
  return db.transaction(async () => {
    // The ticket may have been deleted since the caller looked it up; the
    // tables have no foreign keys, so a row for it would stay orphaned
    await assertTicketExists(db, ticketId);
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
    if (samePrefix.length === 0) {
      const [{ n }] = await db.all<{ n: number }>(`SELECT count(*) AS n FROM ticket_tags WHERE ticket_id = ?`, ticketId);
      if (n >= MAX_TAGS_PER_TICKET) {
        // Name both: in a batch (tag assign a:b c:d --ticket X Y) the plain
        // message didn't say which ticket was full
        const [{ title, tag }] = await db.all<{ title: string; tag: string }>(
          `SELECT (SELECT title FROM tickets WHERE id = ?) AS title, (SELECT prefix || ':' || value FROM tags WHERE id = ?) AS tag`,
          ticketId,
          tagId
        );
        throw new AppError(`Can't add ${tag} to ticket "${title}": a ticket can hold at most ${MAX_TAGS_PER_TICKET} tags`);
      }
    }
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
  });
}

export async function removeTag(
  db: DB,
  ticketId: number,
  tagId: number
): Promise<boolean> {
  return db.transaction(async () => {
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
  });
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

/** Every tag held by the tickets of a project, by ticket id, in one query */
export async function getProjectTicketTags(db: DB, projectId: number): Promise<Map<number, Tag[]>> {
  const rows = await db.all<Tag & { ticket_id: number }>(
    `SELECT tt.ticket_id, t.* FROM ticket_tags tt
     JOIN tags t ON t.id = tt.tag_id
     WHERE t.project_id = ?
     ORDER BY t.prefix, t.value`,
    projectId
  );
  const byTicket = new Map<number, Tag[]>();
  for (const { ticket_id, ...tag } of rows) {
    const list = byTicket.get(ticket_id) ?? [];
    list.push(tag as Tag);
    byTicket.set(ticket_id, list);
  }
  return byTicket;
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
