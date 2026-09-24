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

// States are recognised by name, the same way in every report: a ticket is
// done while it holds the tag now called state:done, and work started when
// it first got a tag called state:wip at that moment. Renaming a state tag
// changes what it means (done -> cancelled is no longer done). An earlier
// rule, "any tag ever called done", counted cancelled tickets as done and
// lost cycle times when a renamed tag was deleted.

// Unrounded lead times, so the average is taken before rounding: averaging
// per-ticket whole days turned 0.5 d and 0.4 d (mean 0.45) into 1.
const exactLeadTimes = new WeakMap<TimeResult, number>();
const exactCycleTimes = new WeakMap<TimeResult, number>();

function timesOf(ticket: { id: number; title: string; created_at: string }, wipAt?: string, doneAt?: string): TimeResult {
  const lead = doneAt ? exactDaysBetween(ticket.created_at, doneAt) : undefined;
  const cycle = wipAt && doneAt ? exactDaysBetween(wipAt, doneAt) : undefined;
  const result: TimeResult = {
    ticketId: ticket.id,
    ticketTitle: ticket.title,
    leadTimeDays: lead !== undefined ? Math.round(lead) : undefined,
    cycleTimeDays: cycle !== undefined ? Math.round(cycle) : undefined,
  };
  if (lead !== undefined) exactLeadTimes.set(result, lead);
  if (cycle !== undefined) exactCycleTimes.set(result, cycle);
  return result;
}

// Work started when the ticket was first tagged state:wip, under the name
// the tag had then: renaming wip (to e.g. doing) must not erase cycle times,
// and renaming another tag to wip must not invent them.
const WIP_STARTS = `SELECT c.ticket_id, min(c.changed_at) AS at FROM ticket_tag_changes c
  WHERE c.action = 'added' AND c.prefix = 'state' AND c.value = 'wip'`;

// Done means *currently* holding the tag called state:done (as in report
// health); a reopened ticket is not done. Completion is the latest time it
// was added.
const DONE_AT = `SELECT c.ticket_id, max(c.changed_at) AS at FROM ticket_tag_changes c
  JOIN tags t ON t.id = c.tag_id AND t.prefix = 'state' AND t.value = 'done'
  JOIN ticket_tags tt ON tt.ticket_id = c.ticket_id AND tt.tag_id = c.tag_id
  WHERE c.action = 'added'`;

export async function getTicketTimes(
  db: DB,
  ticketId: number
): Promise<TimeResult> {
  const [ticket] = await db.all<{ id: number; created_at: string; title: string }>(
    `SELECT id, created_at, title FROM tickets WHERE id = ?`,
    ticketId
  );
  if (!ticket) throw new Error("Ticket not found");
  const [wip] = await db.all<{ at: string | null }>(`${WIP_STARTS} AND c.ticket_id = ?`, ticketId);
  const [done] = await db.all<{ at: string | null }>(`${DONE_AT} AND c.ticket_id = ?`, ticketId);
  return timesOf(ticket, wip?.at ?? undefined, done?.at ?? undefined);
}

/**
 * Times for every ticket of a project, in ticket list order, with three
 * queries in all: per ticket, report times took 2.3 s and ~870 MB for 30,000
 * tickets.
 */
export async function getProjectTimes(db: DB, projectId: number): Promise<TimeResult[]> {
  const tickets = await db.all<{ id: number; created_at: string; title: string }>(
    `SELECT id, created_at, title FROM tickets WHERE project_id = ? ORDER BY created_at`,
    projectId
  );
  const byTicket = async (sql: string) =>
    new Map(
      (await db.all<{ ticket_id: number; at: string }>(
        `${sql} AND c.ticket_id IN (SELECT id FROM tickets WHERE project_id = ?) GROUP BY c.ticket_id`,
        projectId
      )).map((r) => [r.ticket_id, r.at])
    );
  const wip = await byTicket(WIP_STARTS);
  const done = await byTicket(DONE_AT);
  return tickets.map((t) => timesOf(t, wip.get(t.id), done.get(t.id)));
}

export function averageLeadTime(times: TimeResult[]): number | undefined {
  const valid = times.filter((t) => t.leadTimeDays !== undefined);
  if (valid.length === 0) return undefined;
  const sum = valid.reduce((s, t) => s + (exactLeadTimes.get(t) ?? t.leadTimeDays!), 0);
  return Math.round(sum / valid.length);
}

export function averageCycleTime(times: TimeResult[]): number | undefined {
  const valid = times.filter((t) => t.cycleTimeDays !== undefined);
  if (valid.length === 0) return undefined;
  const sum = valid.reduce((s, t) => s + (exactCycleTimes.get(t) ?? t.cycleTimeDays!), 0);
  return Math.round(sum / valid.length);
}

/**
 * The times report as returned by rw report times --json and report_times:
 * every field present (null when there is no value), both averages included.
 */
export function timesReport(times: TimeResult[]) {
  return {
    tickets: times.map((t) => ({
      ticketId: t.ticketId,
      ticketTitle: t.ticketTitle,
      leadTimeDays: t.leadTimeDays ?? null,
      cycleTimeDays: t.cycleTimeDays ?? null,
    })),
    averageLeadTimeDays: averageLeadTime(times) ?? null,
    averageCycleTimeDays: averageCycleTime(times) ?? null,
  };
}
