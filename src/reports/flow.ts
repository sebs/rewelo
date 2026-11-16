import { DB } from "../db/connection.js";
import { getWorkflowDates } from "./times.js";

// A cumulative flow diagram counts, at the end of each day, how many tickets
// have arrived (were created), started and are done. Started and done follow
// the state rules in workflow/states.ts, as lead and cycle times do: work
// started when a ticket was first tagged state:wip, and a ticket is done while
// it holds state:done. A ticket done without ever being wip started when it
// was done, so started never counts fewer than done.
//
// Read across, the gap between the arrived and done lines is lead time, the
// one between started and done cycle time; read down, the band between
// started and done is the work in progress. Deleted tickets are not counted.

/** Cumulative counts at the end of a day (UTC) */
export interface FlowPoint {
  /** The day, YYYY-MM-DD */
  date: string;
  arrived: number;
  started: number;
  done: number;
}

export interface FlowWindow {
  /** Days the window covers, 0 for all since the first ticket */
  days: number;
  /** The counts before the window's first day */
  start: Omit<FlowPoint, "date">;
  /** One point per day, oldest first; a long window samples every few days, ending today */
  points: FlowPoint[];
}

/** When tickets arrived, started and were done, in ms, each list ascending */
export interface FlowEvents {
  arrived: number[];
  started: number[];
  done: number[];
}

/** The windows the dashboard offers, 0 being all */
export const FLOW_WINDOWS = [14, 30, 90, 365, 0] as const;
export const DEFAULT_FLOW_WINDOW = 30;

/** Most points in a window: a longer one is sampled every few days */
export const MAX_FLOW_POINTS = 366;

const DAY_MS = 86_400_000;

export async function getFlowEvents(db: DB, projectId: number): Promise<FlowEvents> {
  const { tickets, wipAt, doneAt } = await getWorkflowDates(db, projectId);
  const ms = (iso: string) => new Date(iso).getTime();
  const events: FlowEvents = { arrived: [], started: [], done: [] };
  for (const t of tickets) {
    events.arrived.push(ms(t.created_at));
    const wip = wipAt.get(t.id);
    const done = doneAt.get(t.id);
    if (done !== undefined) events.done.push(ms(done));
    const starts = [wip, done].filter((at): at is string => at !== undefined).map(ms);
    if (starts.length > 0) events.started.push(Math.min(...starts));
  }
  const ascending = (a: number, b: number) => a - b;
  events.arrived.sort(ascending);
  events.started.sort(ascending);
  events.done.sort(ascending);
  return events;
}

/** How many of the ascending times lie before limit */
function countBefore(times: number[], limit: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countsBefore(events: FlowEvents, limit: number): Omit<FlowPoint, "date"> {
  return {
    arrived: countBefore(events.arrived, limit),
    started: countBefore(events.started, limit),
    done: countBefore(events.done, limit),
  };
}

/**
 * The counts for the days up to now's day (UTC): the last `days` days, or,
 * with 0, every day since the first ticket arrived. No points without tickets.
 */
export function cumulativeFlow(events: FlowEvents, days: number, now: Date): FlowWindow {
  const today = Math.floor(now.getTime() / DAY_MS);
  const firstArrival = events.arrived.length > 0 ? Math.floor(events.arrived[0] / DAY_MS) : today;
  const first = days > 0 ? today - days + 1 : Math.min(today, firstArrival);
  const start = countsBefore(events, first * DAY_MS);
  if (events.arrived.length === 0) return { days, start, points: [] };

  const step = Math.ceil((today - first + 1) / MAX_FLOW_POINTS);
  const points: FlowPoint[] = [];
  for (let day = today; day >= first; day -= step) {
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    points.unshift({ date, ...countsBefore(events, (day + 1) * DAY_MS) });
  }
  return { days, start, points };
}

export async function getCumulativeFlow(db: DB, projectId: number, days: number, now: Date): Promise<FlowWindow> {
  return cumulativeFlow(await getFlowEvents(db, projectId), days, now);
}
