import { DB } from "../db/connection.js";
import { DONE_AT_SQL, WIP_STARTS_SQL } from "../workflow/states.js";

export interface TimeResult {
  ticketId: number;
  ticketTitle: string;
  /** Whole days from creation to done */
  leadTimeDays: number | undefined;
  /** Whole days from the start of work to done */
  cycleTimeDays: number | undefined;
  // Unrounded, so the average is taken before rounding: averaging per-ticket
  // whole days turned 0.5 d and 0.4 d (mean 0.45) into 1. Left out, the
  // averages use the whole days.
  exactLeadTimeDays?: number;
  exactCycleTimeDays?: number;
}

function exactDaysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return (new Date(b).getTime() - new Date(a).getTime()) / msPerDay;
}

// When work started and ended follows the state rules in workflow/states.ts

function timesOf(ticket: { id: number; title: string; created_at: string }, wipAt?: string, doneAt?: string): TimeResult {
  const lead = doneAt ? exactDaysBetween(ticket.created_at, doneAt) : undefined;
  const cycle = wipAt && doneAt ? exactDaysBetween(wipAt, doneAt) : undefined;
  return {
    ticketId: ticket.id,
    ticketTitle: ticket.title,
    leadTimeDays: lead !== undefined ? Math.round(lead) : undefined,
    cycleTimeDays: cycle !== undefined ? Math.round(cycle) : undefined,
    ...(lead !== undefined ? { exactLeadTimeDays: lead } : {}),
    ...(cycle !== undefined ? { exactCycleTimeDays: cycle } : {}),
  };
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
  const wip = await byTicket(WIP_STARTS_SQL);
  const done = await byTicket(DONE_AT_SQL);
  return tickets.map((t) => timesOf(t, wip.get(t.id), done.get(t.id)));
}

export function averageLeadTime(times: TimeResult[]): number | undefined {
  const valid = times.filter((t) => t.leadTimeDays !== undefined);
  if (valid.length === 0) return undefined;
  const sum = valid.reduce((s, t) => s + (t.exactLeadTimeDays ?? t.leadTimeDays!), 0);
  return Math.round(sum / valid.length);
}

export function averageCycleTime(times: TimeResult[]): number | undefined {
  const valid = times.filter((t) => t.cycleTimeDays !== undefined);
  if (valid.length === 0) return undefined;
  const sum = valid.reduce((s, t) => s + (t.exactCycleTimeDays ?? t.cycleTimeDays!), 0);
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
