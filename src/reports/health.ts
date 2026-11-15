import { DB } from "../db/connection.js";
import { listTickets, type Ticket } from "../tickets/repository.js";
import { DIMENSIONS, type Scores } from "../domain/scores.js";
import { cost, exactPriority, round2 } from "../calculations/priority.js";
import { doneTicketIds } from "../workflow/states.js";
import { ValidationError } from "../errors.js";

export interface BacklogHealth {
  totalTickets: number;
  doneTickets: number;
  openTickets: number;
  highPriorityCount: number;
  lowPriorityCount: number;
  highToLowRatio: number | null;
  totalBacklogCost: number;
  /** Open tickets count as stale when their scores haven't changed for this many days */
  staleDays: number;
  /** The stale open tickets, oldest first: when their scores last changed, and how many days ago */
  staleTickets: Array<{ title: string; scoredAt: string; days: number }>;
}

const DAY_MS = 86_400_000;

// When each ticket's scores last changed. A revision is the ticket as it
// was before a change, at revised_at: the scores changed then if they
// differ from the next revision's, or from the ticket's now. Changes of
// title, description or tags don't count. A ticket never re-scored was
// scored when it was created.
async function scoredAt(db: DB, projectId: number, tickets: Ticket[]): Promise<Map<number, string>> {
  const revisions = await db.all<Scores & { ticket_id: number; revised_at: string }>(
    `SELECT r.ticket_id, r.benefit, r.penalty, r.estimate, r.risk, r.revised_at
     FROM ticket_revisions r JOIN tickets t ON t.id = r.ticket_id
     WHERE t.project_id = ?
     ORDER BY r.ticket_id, r.id`,
    projectId
  );
  const byTicket = new Map<number, typeof revisions>();
  for (const r of revisions) byTicket.set(r.ticket_id, [...(byTicket.get(r.ticket_id) ?? []), r]);
  const same = (a: Scores, b: Scores) => DIMENSIONS.every((d) => a[d] === b[d]);

  const at = new Map<number, string>();
  for (const t of tickets) {
    const states: Scores[] = [...(byTicket.get(t.id) ?? []), t];
    let last = t.created_at;
    byTicket.get(t.id)?.forEach((r, i) => {
      if (!same(r, states[i + 1])) last = r.revised_at;
    });
    at.set(t.id, last);
  }
  return at;
}

/** The high:low ratio as rw shows it, with why there is none */
export function highToLowRatioText(health: BacklogHealth): string {
  if (health.highToLowRatio !== null) return String(health.highToLowRatio);
  return health.highPriorityCount > 0 ? "n/a (no low-priority tickets)" : "n/a";
}

export async function getBacklogHealth(
  db: DB,
  projectId: number,
  highThreshold: number = 1.5,
  staleDays: number = 90
): Promise<BacklogHealth> {
  // Every priority is over 0: a threshold of 0 or less counts all as high
  if (!(highThreshold > 0) || !Number.isFinite(highThreshold)) {
    throw new ValidationError(`The high priority threshold must be a number greater than 0, got ${highThreshold}`);
  }
  if (!Number.isInteger(staleDays) || staleDays <= 0) {
    throw new ValidationError(`staleDays must be a whole number greater than 0, got ${staleDays}`);
  }
  const tickets = await listTickets(db, projectId, { withDescription: false });

  const doneIds = await doneTicketIds(db, projectId);

  let highCount = 0;
  let lowCount = 0;
  let backlogCost = 0;

  for (const t of tickets) {
    if (doneIds.has(t.id)) continue;

    const prio = exactPriority(t);
    if (prio >= highThreshold) {
      highCount++;
    } else {
      lowCount++;
    }
    backlogCost += cost(t);
  }

  const doneCount = doneIds.size;

  const open = tickets.filter((t) => !doneIds.has(t.id));
  const scored = await scoredAt(db, projectId, open);
  const now = Date.now();
  const staleTickets = open
    .map((t) => ({ title: t.title, scoredAt: scored.get(t.id)!, days: Math.floor((now - Date.parse(scored.get(t.id)!)) / DAY_MS) }))
    .filter((t) => t.days >= staleDays)
    .sort((a, b) => a.scoredAt.localeCompare(b.scoredAt) || a.title.localeCompare(b.title));

  return {
    totalTickets: tickets.length,
    doneTickets: doneCount,
    openTickets: tickets.length - doneCount,
    highPriorityCount: highCount,
    lowPriorityCount: lowCount,
    highToLowRatio: lowCount > 0 ? round2(highCount / lowCount) : null,
    totalBacklogCost: backlogCost,
    staleDays,
    staleTickets,
  };
}
