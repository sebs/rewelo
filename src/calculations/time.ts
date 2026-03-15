import { DB } from "../db/connection.js";

interface TimeResult {
  ticketId: number;
  ticketTitle: string;
  leadTimeDays: number | undefined;
  cycleTimeDays: number | undefined;
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / msPerDay
  );
}

export async function getTicketTimes(
  db: DB,
  ticketId: number
): Promise<TimeResult> {
  const ticket = await db.all<{ created_at: string; title: string }>(
    `SELECT created_at, title FROM rw.tickets WHERE id = ?`,
    ticketId
  );
  if (ticket.length === 0) throw new Error("Ticket not found");

  const createdAt = ticket[0].created_at;

  // Find first state:wip added
  const wipRows = await db.all<{ changed_at: string }>(
    `SELECT c.changed_at FROM rw.ticket_tag_changes c
     JOIN rw.tags t ON t.id = c.tag_id
     WHERE c.ticket_id = ? AND c.action = 'added' AND t.prefix = 'state' AND t.value = 'wip'
     ORDER BY c.changed_at
     LIMIT 1`,
    ticketId
  );

  // Find first state:done added
  const doneRows = await db.all<{ changed_at: string }>(
    `SELECT c.changed_at FROM rw.ticket_tag_changes c
     JOIN rw.tags t ON t.id = c.tag_id
     WHERE c.ticket_id = ? AND c.action = 'added' AND t.prefix = 'state' AND t.value = 'done'
     ORDER BY c.changed_at
     LIMIT 1`,
    ticketId
  );

  const doneAt = doneRows.length > 0 ? doneRows[0].changed_at : undefined;
  const wipAt = wipRows.length > 0 ? wipRows[0].changed_at : undefined;

  return {
    ticketId,
    ticketTitle: ticket[0].title,
    leadTimeDays: doneAt ? daysBetween(createdAt, doneAt) : undefined,
    cycleTimeDays: wipAt && doneAt ? daysBetween(wipAt, doneAt) : undefined,
  };
}

export function averageLeadTime(times: TimeResult[]): number | undefined {
  const valid = times.filter((t) => t.leadTimeDays !== undefined);
  if (valid.length === 0) return undefined;
  const sum = valid.reduce((s, t) => s + t.leadTimeDays!, 0);
  return Math.round(sum / valid.length);
}
