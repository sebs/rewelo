import { DB } from "../db/connection.js";
import { Ticket } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";

export interface TicketRevision {
  id: number;
  ticket_id: number;
  title: string;
  description: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: string;
  revised_at: string;
}

export async function createRevision(
  db: DB,
  ticket: Ticket
): Promise<void> {
  const tags = await getTicketTags(db, ticket.id);
  const tagSnapshot = JSON.stringify(
    tags.map((t) => ({ prefix: t.prefix, value: t.value }))
  );

  await db.run(
    `INSERT INTO rw.ticket_revisions (ticket_id, title, description, benefit, penalty, estimate, risk, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ticket.id,
    ticket.title,
    ticket.description,
    ticket.benefit,
    ticket.penalty,
    ticket.estimate,
    ticket.risk,
    tagSnapshot
  );
}

export async function listRevisions(
  db: DB,
  ticketId: number
): Promise<TicketRevision[]> {
  return db.all<TicketRevision>(
    `SELECT * FROM rw.ticket_revisions WHERE ticket_id = ? ORDER BY revised_at, id`,
    ticketId
  );
}

export async function listProjectRevisions(
  db: DB,
  projectId: number,
  since?: string,
  limit?: number
): Promise<(TicketRevision & { ticket_title: string })[]> {
  let sql = `SELECT r.*, t.title AS ticket_title
     FROM rw.ticket_revisions r
     JOIN rw.tickets t ON t.id = r.ticket_id
     WHERE t.project_id = ?`;
  const params: unknown[] = [projectId];

  if (since) {
    sql += ` AND r.revised_at >= ?`;
    params.push(since);
  }

  sql += ` ORDER BY r.revised_at DESC, r.id DESC`;

  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }

  return db.all<TicketRevision & { ticket_title: string }>(sql, ...params);
}
