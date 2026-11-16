import { DB } from "../db/connection.js";
import { getWorkflowDates } from "./times.js";

// The flow report: how much gets done per week, how long tickets take, and
// which started tickets are already older than most took. Times are given
// as percentiles ("85% of tickets were done within 6 days"), which an
// average hides: one ticket that took months moves the mean, not the 85th
// percentile. Started and done follow the rules in workflow/states.ts, as
// lead and cycle times and the cumulative flow do.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export const DEFAULT_FLOW_WEEKS = 12;

/** Nearest-rank percentiles of times in days, rounded to one decimal; null without any */
export interface Percentiles {
  count: number;
  p50: number | null;
  p85: number | null;
  p95: number | null;
}

export interface FlowReport {
  /** Complete weeks covered, 0 for all since the first ticket */
  weeks: number;
  /** The first day covered (a Monday, UTC), YYYY-MM-DD */
  from: string;
  /** Tickets done per week (weeks start on Monday, UTC), oldest first; the last one is the current week, so far */
  throughput: Array<{ weekStart: string; done: number; partial: boolean }>;
  /** Done per complete week, on average, rounded to one decimal; null without a complete week */
  averagePerWeek: number | null;
  /** Of the tickets done since from: started (first state:wip) to done */
  cycleTimeDays: Percentiles;
  /** Of the tickets done since from: created to done */
  leadTimeDays: Percentiles;
  /** Started and not done, oldest first; older than the 85th percentile of cycle time: stuck, or about to be late */
  inProgress: Array<{ ticketId: number; title: string; startedAt: string; ageDays: number; olderThanP85: boolean }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday (UTC) of the week ms falls in */
export function weekStart(ms: number): number {
  const day = Math.floor(ms / DAY_MS);
  // 1970-01-01 was a Thursday: day 0 is weekday 3 counted from Monday
  return (day - ((day + 3) % 7)) * DAY_MS;
}

/** Nearest rank: the smallest value with at least p% of the values at or below it */
export function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => (sorted.length === 0 ? null : round1(sorted[Math.ceil((p / 100) * sorted.length) - 1]));
  return { count: sorted.length, p50: at(50), p85: at(85), p95: at(95) };
}

export async function getFlowReport(db: DB, projectId: number, weeks: number = DEFAULT_FLOW_WEEKS, now: Date = new Date()): Promise<FlowReport> {
  const { tickets, wipAt, doneAt } = await getWorkflowDates(db, projectId);
  const ms = (iso: string) => new Date(iso).getTime();
  const current = weekStart(now.getTime());
  // Oldest first (getWorkflowDates)
  const firstTicket = tickets.length > 0 ? weekStart(ms(tickets[0].created_at)) : current;
  const from = weeks > 0 ? current - weeks * WEEK_MS : Math.min(firstTicket, current);

  const done = tickets.filter((t) => doneAt.has(t.id) && ms(doneAt.get(t.id)!) >= from);
  const perWeek = new Map<number, number>();
  for (const t of done) {
    const week = weekStart(ms(doneAt.get(t.id)!));
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  const throughput: FlowReport["throughput"] = [];
  for (let week = from; week <= current; week += WEEK_MS) {
    throughput.push({ weekStart: isoDay(week), done: perWeek.get(week) ?? 0, partial: week === current });
  }
  const complete = throughput.filter((w) => !w.partial);
  const averagePerWeek = complete.length > 0 ? round1(complete.reduce((sum, w) => sum + w.done, 0) / complete.length) : null;

  const days = (a: string, b: string) => (ms(b) - ms(a)) / DAY_MS;
  const cycleTimeDays = percentiles(done.filter((t) => wipAt.has(t.id)).map((t) => days(wipAt.get(t.id)!, doneAt.get(t.id)!)));
  const leadTimeDays = percentiles(done.map((t) => days(t.created_at, doneAt.get(t.id)!)));

  const inProgress = tickets
    .filter((t) => wipAt.has(t.id) && !doneAt.has(t.id))
    .map((t) => {
      const ageDays = round1((now.getTime() - ms(wipAt.get(t.id)!)) / DAY_MS);
      return { ticketId: t.id, title: t.title, startedAt: wipAt.get(t.id)!, ageDays, olderThanP85: cycleTimeDays.p85 !== null && ageDays > cycleTimeDays.p85 };
    })
    .sort((a, b) => b.ageDays - a.ageDays);

  return { weeks, from: isoDay(from), throughput, averagePerWeek, cycleTimeDays, leadTimeDays, inProgress };
}
