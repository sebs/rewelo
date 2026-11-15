import { DB } from "../db/connection.js";
import { listTickets, Ticket } from "../tickets/repository.js";
import { getWeights, setWeights, WeightConfig } from "../weights/repository.js";
import { priority } from "../calculations/priority.js";
import { calculateAllRelativeWeights, RelativeWeights } from "../calculations/relative-weights.js";
import { exactWeightedPriority, weightedPriority } from "../calculations/weighted-priority.js";
import { validateWeights, withOverrides, type Weights } from "../domain/weights.js";
import { parseTag } from "../validation/strings.js";
import { openBlockers } from "../relations/blocking.js";

/** The tickets calculations look at: those with every tag given (prefix:value), without descriptions */
export async function ticketsInScope(db: DB, projectId: number, tags: string[] = []): Promise<Ticket[]> {
  return listTickets(db, projectId, { includeTags: tags.map((s) => parseTag(s)), withDescription: false });
}

export interface WeightedRanking {
  /** The weights used: the project's, with the overrides applied */
  weights: Weights;
  /** blockedBy: the open tickets that block it (blocks, depends-on), only when there are any */
  tickets: Array<{ title: string; priority: number; weighted: number; blockedBy?: string[] }>;
}

/**
 * Tickets by weighted priority, highest first, under the project's weights
 * or, for this call only, overrides of them. Sorted on the unrounded
 * weighted priority; the rounded one is returned. With unblocked, the
 * tickets an open ticket blocks are left out: what can be started now.
 */
export async function weightedRanking(
  db: DB,
  projectId: number,
  options: { tags?: string[]; weights?: Partial<Weights>; unblocked?: boolean } = {}
): Promise<WeightedRanking> {
  const weights = withOverrides(await getWeights(db, projectId), options.weights);
  validateWeights(weights);
  const blockers = await openBlockers(db, projectId);
  const tickets = (await ticketsInScope(db, projectId, options.tags)).filter((t) => !options.unblocked || !blockers.has(t.id));

  const exact = (t: Ticket) => exactWeightedPriority(t, weights);
  return {
    weights,
    tickets: [...tickets]
      .sort((a, b) => exact(b) - exact(a))
      .map((t) => ({
        title: t.title,
        priority: priority(t),
        weighted: weightedPriority(t, weights),
        ...(blockers.has(t.id) ? { blockedBy: blockers.get(t.id) } : {}),
      })),
  };
}

/** Each ticket's share of the scores of the tickets in scope */
export async function relativeWeights(
  db: DB,
  projectId: number,
  options: { tags?: string[] } = {}
): Promise<Array<{ title: string } & RelativeWeights>> {
  const tickets = await ticketsInScope(db, projectId, options.tags);
  return calculateAllRelativeWeights(tickets).map((t) => ({
    title: t.title,
    relativeBenefit: t.relativeBenefit,
    relativePenalty: t.relativePenalty,
    relativeEstimate: t.relativeEstimate,
    relativeRisk: t.relativeRisk,
  }));
}

/** Set the weights given; the others keep their current value */
export async function updateWeights(db: DB, projectId: number, overrides: Partial<Weights>): Promise<WeightConfig> {
  return setWeights(db, projectId, withOverrides(await getWeights(db, projectId), overrides));
}
