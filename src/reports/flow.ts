import { DB } from "../db/connection.js";
import { getWorkflowDates } from "./times.js";
import { cost, value } from "../calculations/priority.js";
import type { Scores } from "../domain/scores.js";

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
//
// Instead of tickets the flow can sum a score of theirs (a measure): the
// value that has arrived, started and is done, or the cost. Scores are the
// tickets' current ones: the flow of value is the value of the tickets that
// moved, as they are scored now.

/** What the flow counts: tickets, or the sum of one of their scores */
export const FLOW_MEASURES = ["count", "benefit", "penalty", "estimate", "risk", "value", "cost"] as const;
export type FlowMeasure = (typeof FLOW_MEASURES)[number];
export const DEFAULT_FLOW_MEASURE: FlowMeasure = "count";

/** What a ticket adds to the flow in a measure */
export function measureOf(measure: FlowMeasure, scores: Scores): number {
  if (measure === "count") return 1;
  if (measure === "value") return value(scores);
  if (measure === "cost") return cost(scores);
  return scores[measure];
}

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
  /** What the counts are: tickets, or the sum of a score */
  measure: FlowMeasure;
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
  /** What the weights measure; without them, tickets are counted */
  measure?: FlowMeasure;
  /** What each event adds, in the order of its list; 1 each without */
  weights?: { arrived: number[]; started: number[]; done: number[] };
}

/** When tickets arrived, started and were done, ascending, with their scores */
export interface ScoredFlowEvents {
  arrived: Array<{ at: number; scores: Scores }>;
  started: Array<{ at: number; scores: Scores }>;
  done: Array<{ at: number; scores: Scores }>;
}

/** The windows the dashboard offers, 0 being all */
export const FLOW_WINDOWS = [14, 30, 90, 365, 0] as const;
export const DEFAULT_FLOW_WINDOW = 30;

/** Most points in a window: a longer one is sampled every few days */
export const MAX_FLOW_POINTS = 366;

const DAY_MS = 86_400_000;

export async function getScoredFlowEvents(db: DB, projectId: number): Promise<ScoredFlowEvents> {
  const { tickets, wipAt, doneAt } = await getWorkflowDates(db, projectId);
  const scores = new Map(
    (await db.all<Scores & { id: number }>(
      `SELECT id, benefit, penalty, estimate, risk FROM tickets WHERE project_id = ?`,
      projectId
    )).map(({ id, ...s }) => [id, s])
  );
  const ms = (iso: string) => new Date(iso).getTime();
  const events: ScoredFlowEvents = { arrived: [], started: [], done: [] };
  for (const t of tickets) {
    const s = scores.get(t.id)!;
    events.arrived.push({ at: ms(t.created_at), scores: s });
    const wip = wipAt.get(t.id);
    const done = doneAt.get(t.id);
    if (done !== undefined) events.done.push({ at: ms(done), scores: s });
    const starts = [wip, done].filter((at): at is string => at !== undefined).map(ms);
    if (starts.length > 0) events.started.push({ at: Math.min(...starts), scores: s });
  }
  const ascending = (a: { at: number }, b: { at: number }) => a.at - b.at;
  events.arrived.sort(ascending);
  events.started.sort(ascending);
  events.done.sort(ascending);
  return events;
}

/** The events in a measure: their times, and with a score, what each adds */
export function flowEventsIn(events: ScoredFlowEvents, measure: FlowMeasure): FlowEvents {
  const times = (list: ScoredFlowEvents["arrived"]) => list.map((e) => e.at);
  const weigh = (list: ScoredFlowEvents["arrived"]) => list.map((e) => measureOf(measure, e.scores));
  const counted = { arrived: times(events.arrived), started: times(events.started), done: times(events.done) };
  if (measure === "count") return counted;
  return { ...counted, measure, weights: { arrived: weigh(events.arrived), started: weigh(events.started), done: weigh(events.done) } };
}

export async function getFlowEvents(db: DB, projectId: number): Promise<FlowEvents> {
  return flowEventsIn(await getScoredFlowEvents(db, projectId), "count");
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

/** Per list, the sum of its first n weights at n */
type Sums = { arrived: number[]; started: number[]; done: number[] };

/** What has arrived, started and is done before limit: per event 1, or its weight */
function countsBefore(events: FlowEvents, sums: Sums | undefined, limit: number): Omit<FlowPoint, "date"> {
  const total = (key: keyof Sums) => {
    const n = countBefore(events[key], limit);
    return sums ? sums[key][n] : n;
  };
  return { arrived: total("arrived"), started: total("started"), done: total("done") };
}

function prefixSums(weights: number[]): number[] {
  const sums = [0];
  for (const w of weights) sums.push(sums[sums.length - 1] + w);
  return sums;
}

/**
 * The counts for the days up to now's day (UTC): the last `days` days, or,
 * with 0, every day since the first ticket arrived. No points without tickets.
 */
export function cumulativeFlow(events: FlowEvents, days: number, now: Date): FlowWindow {
  const measure = events.measure ?? DEFAULT_FLOW_MEASURE;
  const { weights } = events;
  const sums = weights && { arrived: prefixSums(weights.arrived), started: prefixSums(weights.started), done: prefixSums(weights.done) };
  const today = Math.floor(now.getTime() / DAY_MS);
  const firstArrival = events.arrived.length > 0 ? Math.floor(events.arrived[0] / DAY_MS) : today;
  const first = days > 0 ? today - days + 1 : Math.min(today, firstArrival);
  const start = countsBefore(events, sums, first * DAY_MS);
  if (events.arrived.length === 0) return { days, measure, start, points: [] };

  const step = Math.ceil((today - first + 1) / MAX_FLOW_POINTS);
  const points: FlowPoint[] = [];
  for (let day = today; day >= first; day -= step) {
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    points.unshift({ date, ...countsBefore(events, sums, (day + 1) * DAY_MS) });
  }
  return { days, measure, start, points };
}

export async function getCumulativeFlow(db: DB, projectId: number, days: number, now: Date): Promise<FlowWindow> {
  return cumulativeFlow(await getFlowEvents(db, projectId), days, now);
}
