import { DB } from "../db/connection.js";
import { Tag } from "./repository.js";

export interface TicketTag {
  ticket_id: number;
  tag_id: number;
  assigned_at: string;
}

export async function assignTag(
  db: DB,
  ticketId: number,
  tagId: number
): Promise<boolean> {
  // Check if already assigned (idempotent)
  const existing = await db.all(
    `SELECT 1 FROM rw.ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
    ticketId,
    tagId
  );
  if (existing.length > 0) return false;

  await db.run(
    `INSERT INTO rw.ticket_tags (ticket_id, tag_id) VALUES (?, ?)`,
    ticketId,
    tagId
  );
  await db.run(
    `INSERT INTO rw.ticket_tag_changes (ticket_id, tag_id, action) VALUES (?, ?, 'added')`,
    ticketId,
    tagId
  );
  return true;
}

export async function removeTag(
  db: DB,
  ticketId: number,
  tagId: number
): Promise<boolean> {
  const existing = await db.all(
    `SELECT 1 FROM rw.ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
    ticketId,
    tagId
  );
  if (existing.length === 0) return false;

  await db.run(
    `DELETE FROM rw.ticket_tags WHERE ticket_id = ? AND tag_id = ?`,
    ticketId,
    tagId
  );
  await db.run(
    `INSERT INTO rw.ticket_tag_changes (ticket_id, tag_id, action) VALUES (?, ?, 'removed')`,
    ticketId,
    tagId
  );
  return true;
}

export async function getTicketTags(db: DB, ticketId: number): Promise<Tag[]> {
  return db.all<Tag>(
    `SELECT t.* FROM rw.tags t
     JOIN rw.ticket_tags tt ON tt.tag_id = t.id
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
    `SELECT tt.ticket_id FROM rw.ticket_tags tt
     JOIN rw.tickets tk ON tk.id = tt.ticket_id
     WHERE tt.tag_id = ? AND tk.project_id = ?`,
    tagId,
    projectId
  );
  return rows.map((r) => r.ticket_id);
}
