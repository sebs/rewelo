import { DB } from "../db/connection.js";

export interface TagChange {
  id: number;
  ticket_id: number;
  tag_id: number;
  action: "added" | "removed";
  prefix: string;
  value: string;
  changed_at: string;
}

export async function getTagChangeLog(
  db: DB,
  ticketId: number
): Promise<TagChange[]> {
  return db.all<TagChange>(
    `SELECT c.id, c.ticket_id, c.tag_id, c.action, c.prefix, c.value, c.changed_at
     FROM ticket_tag_changes c
     WHERE c.ticket_id = ?
     ORDER BY c.id`,
    ticketId
  );
}
