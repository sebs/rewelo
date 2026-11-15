import { DB } from "../db/connection.js";
import { AppError } from "../errors.js";
import { listTickets, type Ticket } from "../tickets/repository.js";
import { getWeights } from "../weights/repository.js";
import { rank } from "../calculations/scenario.js";
import { weightedPriority } from "../calculations/weighted-priority.js";
import { openBlockerTickets } from "../relations/blocking.js";
import { doneTicketIds } from "../workflow/states.js";
import { parseTag } from "../validation/strings.js";

/** What a ticket takes out of the capacity: its estimate, or its cost (estimate + risk) */
export const EFFORTS = ["estimate", "cost"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface PlannedTicket {
  title: string;
  /** Rank among the open tickets in scope; null for a blocker from outside it (or excluded) */
  rank: number | null;
  effort: number;
  weighted: number;
  /** For a blocker pulled in: the tickets in the plan it has to come before */
  for?: string[];
}

export interface CapacityPlan {
  capacity: number;
  effort: Effort;
  used: number;
  remaining: number;
  /** In the order to work on them: every blocker before the tickets it blocks */
  tickets: PlannedTicket[];
  /** Tickets ranked above the last one planned that didn't fit; needs: with their unplanned blockers */
  skipped: Array<{ title: string; rank: number; effort: number; needs: number }>;
}

/**
 * The open tickets that fit a capacity, by weighted priority: each ticket
 * comes with its open blockers (blocks, depends-on, transitively), and is
 * skipped when they don't fit together. Filling goes on past a skipped
 * ticket, so smaller ones further down use what is left. The arithmetic is
 * done here, so a model planning a sprint doesn't do it.
 */
export async function planCapacity(
  db: DB,
  projectId: number,
  options: { capacity: number; effort?: Effort; tags?: string[]; excludeTags?: string[] }
): Promise<CapacityPlan> {
  const { capacity, effort = "estimate" } = options;
  if (!Number.isFinite(capacity) || capacity <= 0) throw new AppError(`capacity must be a positive number, got ${capacity}`);

  const { w1, w2, w3, w4 } = await getWeights(db, projectId);
  const weights = { w1, w2, w3, w4 };
  const done = await doneTicketIds(db, projectId);
  // Candidates: the open tickets with every tag and none of the excluded
  // ones (state:wip, for a sprint: work already under way)
  const candidates = await listTickets(db, projectId, {
    includeTags: (options.tags ?? []).map((s) => parseTag(s)),
    excludeTags: (options.excludeTags ?? []).map((s) => parseTag(s)),
    withDescription: false,
  });
  const ranked = rank(candidates.filter((t) => !done.has(t.id)), weights);
  const rankOf = new Map(ranked.map((t, i) => [t.id, i + 1]));
  // Blockers may lie outside the scope or be excluded: every ticket, by id
  const byId = new Map((await listTickets(db, projectId, { withDescription: false })).map((t) => [t.id, t]));
  const blockers = await openBlockerTickets(db, projectId);
  const effortOf = (t: Ticket) => (effort === "cost" ? t.estimate + t.risk : t.estimate);

  const planned = new Map<number, PlannedTicket>();
  const order: PlannedTicket[] = [];
  const skipped: CapacityPlan["skipped"] = [];
  let used = 0;
  let lastRank = 0;

  for (const ticket of ranked) {
    if (planned.has(ticket.id)) continue;
    // The unplanned blockers, each after its own, then the ticket. Relations
    // can't form a cycle (createRelation refuses one); seen guards anyway.
    const group: Ticket[] = [];
    const seen = new Set<number>();
    const visit = (t: Ticket) => {
      if (seen.has(t.id) || planned.has(t.id)) return;
      seen.add(t.id);
      for (const b of blockers.get(t.id) ?? []) visit(byId.get(b.id)!);
      group.push(t);
    };
    visit(ticket);

    const needs = group.reduce((sum, t) => sum + effortOf(t), 0);
    if (used + needs > capacity) {
      skipped.push({ title: ticket.title, rank: rankOf.get(ticket.id)!, effort: effortOf(ticket), needs });
      continue;
    }
    for (const t of group) {
      const entry: PlannedTicket = { title: t.title, rank: rankOf.get(t.id) ?? null, effort: effortOf(t), weighted: weightedPriority(t, weights) };
      if (t !== ticket) entry.for = [ticket.title];
      planned.set(t.id, entry);
      order.push(entry);
    }
    used += needs;
    lastRank = rankOf.get(ticket.id)!;
  }

  return {
    capacity,
    effort,
    used,
    remaining: capacity - used,
    tickets: order,
    skipped: skipped.filter((s) => s.rank < lastRank),
  };
}
