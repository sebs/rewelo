import { DB } from "../db/connection.js";

interface TimeResult {
  ticketId: number;
  ticketTitle: string;
  leadTimeDays: number | undefined;
  cycleTimeDays: number | undefined;
}

function exactDaysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return (new Date(b).getTime() - new Date(a).getTime()) / msPerDay;
}

// Unrounded lead times, so the average is taken before rounding: averaging
// per-ticket whole days turned 0.5 d and 0.4 d (mean 0.45) into 1.
const exactLeadTimes = new WeakMap<TimeResult, number>();

export async function getTicketTimes(
  db: DB,
  ticketId: number
): Promise<TimeResult> {
  const ticket = await db.all<{ created_at: string; title: string }>(
    `SELECT created_at, title FROM tickets WHERE id = ?`,
    ticketId
  );
  if (ticket.length === 0) throw new Error("Ticket not found");

  const createdAt = ticket[0].created_at;

  // Find first state:wip added
  const wipRows = await db.all<{ changed_at: string }>(
    `SELECT c.changed_at FROM ticket_tag_changes c
     JOIN tags t ON t.id = c.tag_id
     WHERE c.ticket_id = ? AND c.action = 'added' AND t.prefix = 'state' AND t.value = 'wip'
     ORDER BY c.changed_at
     LIMIT 1`,
    ticketId
  );

  // Done means *currently* tagged state:done (as in report health); a
  // reopened ticket is not done. Completion is the latest time it was added.
  const doneRows = await db.all<{ changed_at: string }>(
    `SELECT c.changed_at FROM ticket_tag_changes c
     JOIN tags t ON t.id = c.tag_id
     WHERE c.ticket_id = ? AND c.action = 'added' AND t.prefix = 'state' AND t.value = 'done'
       AND EXISTS (SELECT 1 FROM ticket_tags tt WHERE tt.ticket_id = c.ticket_id AND tt.tag_id = c.tag_id)
     ORDER BY c.changed_at DESC, c.id DESC
     LIMIT 1`,
    ticketId
  );

  const doneAt = doneRows.length > 0 ? doneRows[0].changed_at : undefined;
  const wipAt = wipRows.length > 0 ? wipRows[0].changed_at : undefined;

  const lead = doneAt ? exactDaysBetween(createdAt, doneAt) : undefined;
  const result: TimeResult = {
    ticketId,
    ticketTitle: ticket[0].title,
    leadTimeDays: lead !== undefined ? Math.round(lead) : undefined,
    cycleTimeDays: wipAt && doneAt ? Math.round(exactDaysBetween(wipAt, doneAt)) : undefined,
  };
  if (lead !== undefined) exactLeadTimes.set(result, lead);
  return result;
}

export function averageLeadTime(times: TimeResult[]): number | undefined {
  const valid = times.filter((t) => t.leadTimeDays !== undefined);
  if (valid.length === 0) return undefined;
  const sum = valid.reduce((s, t) => s + (exactLeadTimes.get(t) ?? t.leadTimeDays!), 0);
  return Math.round(sum / valid.length);
}
