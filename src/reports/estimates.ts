import { DB } from "../db/connection.js";
import { FIBONACCI, type Fibonacci } from "../domain/scores.js";
import { getWorkflowDates } from "./times.js";
import { percentiles } from "./flow-metrics.js";

// Do estimates predict anything? Estimate is half of cost in the priority
// formula, so the ranking is only as good as they are. Every done ticket
// with a cycle time tells: what it was estimated, and how long it took.
//
// The estimate is the one the ticket had when work started: a ticket
// re-estimated afterwards (often to what it turned out to take) would
// otherwise make the estimates look better than they were. A revision
// holds a ticket's scores before a change, so the earliest revision after
// the start has the scores at the start; without one, they never changed.

/** At least this many tickets for a correlation: fewer say little */
export const MIN_TICKETS_FOR_CORRELATION = 5;

export interface EstimateAccuracy {
  /** Done tickets with a cycle time (started with state:wip) */
  tickets: number;
  /** Done tickets that never were wip, so have no cycle time and aren't counted */
  withoutCycleTime: number;
  /** Of the tickets counted, those whose estimate changed after work started */
  reEstimated: number;
  /** Per estimate (at the start) that any ticket had: cycle time percentiles in days */
  byEstimate: Array<{ estimate: Fibonacci; count: number; p50: number | null; p85: number | null }>;
  /** Spearman's rank correlation of estimate and cycle time, -1 to 1, two decimals; null below MIN_TICKETS_FOR_CORRELATION */
  correlation: number | null;
  /** What the correlation means, in a sentence */
  verdict: string;
}

/** Ranks from 1, ties sharing the average of their ranks */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const result = new Array<number>(values.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1][0] === order[start][0]) end++;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) result[order[k][1]] = rank;
    start = end + 1;
  }
  return result;
}

/** Spearman's rho: Pearson's correlation of the ranks; null when either side doesn't vary */
export function spearman(xs: number[], ys: number[]): number | null {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (rx.length + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < rx.length; i++) {
    cov += (rx[i] - mean) * (ry[i] - mean);
    vx += (rx[i] - mean) ** 2;
    vy += (ry[i] - mean) ** 2;
  }
  return vx === 0 || vy === 0 ? null : cov / Math.sqrt(vx * vy);
}

export function verdict(tickets: number, correlation: number | null): string {
  if (tickets < MIN_TICKETS_FOR_CORRELATION) {
    return `Too few done tickets with a cycle time (${tickets}) to tell: it takes ${MIN_TICKETS_FOR_CORRELATION}.`;
  }
  if (correlation === null) return "All tickets had the same estimate, or took the same time: nothing to compare.";
  if (correlation >= 0.6) return "Estimates predict cycle time well: larger estimates took clearly longer.";
  if (correlation >= 0.3) return "Estimates predict cycle time somewhat: larger estimates tended to take longer.";
  if (correlation > -0.3) return "Estimates don't predict cycle time: tickets took about as long whatever their estimate.";
  return "Larger estimates finished faster: the estimates run against how long tickets took.";
}

export async function getEstimateAccuracy(db: DB, projectId: number): Promise<EstimateAccuracy> {
  const { tickets, wipAt, doneAt } = await getWorkflowDates(db, projectId);
  const estimates = new Map(
    (await db.all<{ id: number; estimate: Fibonacci }>("SELECT id, estimate FROM tickets WHERE project_id = ?", projectId)).map((r) => [r.id, r.estimate])
  );
  // Every revision's estimate, in order per ticket
  const revisions = new Map<number, Array<{ estimate: Fibonacci; at: number }>>();
  for (const r of await db.all<{ ticket_id: number; estimate: Fibonacci; revised_at: string }>(
    `SELECT ticket_id, estimate, revised_at FROM ticket_revisions
     WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)
     ORDER BY ticket_id, revised_at, id`,
    projectId
  )) {
    const revision = { estimate: r.estimate, at: new Date(r.revised_at).getTime() };
    const list = revisions.get(r.ticket_id);
    if (list) list.push(revision);
    else revisions.set(r.ticket_id, [revision]);
  }

  const done = tickets.filter((t) => doneAt.has(t.id));
  const measured = done
    .filter((t) => wipAt.has(t.id))
    .map((t) => {
      const started = new Date(wipAt.get(t.id)!).getTime();
      const now = estimates.get(t.id)!;
      const later = (revisions.get(t.id) ?? []).find((r) => r.at > started);
      const atStart = later ? later.estimate : now;
      const days = (new Date(doneAt.get(t.id)!).getTime() - started) / 86_400_000;
      return { estimate: atStart, reEstimated: atStart !== now, days };
    });

  const byEstimate = FIBONACCI.flatMap((estimate) => {
    const group = measured.filter((m) => m.estimate === estimate);
    if (group.length === 0) return [];
    const p = percentiles(group.map((m) => m.days));
    return [{ estimate, count: p.count, p50: p.p50, p85: p.p85 }];
  });
  const rho = measured.length >= MIN_TICKETS_FOR_CORRELATION ? spearman(measured.map((m) => m.estimate), measured.map((m) => m.days)) : null;
  const correlation = rho === null ? null : Math.round(rho * 100) / 100;

  return {
    tickets: measured.length,
    withoutCycleTime: done.length - measured.length,
    reEstimated: measured.filter((m) => m.reEstimated).length,
    byEstimate,
    correlation,
    verdict: verdict(measured.length, correlation),
  };
}
