import { DB } from "../db/connection.js";
import { listTickets, Ticket } from "../tickets/repository.js";
import { getWeights, setWeights, WeightConfig } from "../weights/repository.js";
import { priority } from "../calculations/priority.js";
import { calculateAllRelativeWeights, RelativeWeights } from "../calculations/relative-weights.js";
import { exactWeightedPriority, weightedPriority } from "../calculations/weighted-priority.js";
import { validateWeights, withOverrides, type Weights } from "../domain/weights.js";
import { parseTag } from "../validation/strings.js";

/** The tickets calculations look at: those with every tag given (prefix:value), without descriptions */
export async function ticketsInScope(db: DB, projectId: number, tags: string[] = []): Promise<Ticket[]> {
  return listTickets(db, projectId, { includeTags: tags.map((s) => parseTag(s)), withDescription: false });
}

export interface WeightedRanking {
  /** The weights used: the project's, with the overrides applied */
  weights: Weights;
  tickets: Array<{ title: string; priority: number; weighted: number }>;
}

/**
 * Tickets by weighted priority, highest first, under the project's weights
 * or, for this call only, overrides of them. Sorted on the unrounded
 * weighted priority; the rounded one is returned.
 */
export async function weightedRanking(
  db: DB,
  projectId: number,
  options: { tags?: string[]; weights?: Partial<Weights> } = {}
): Promise<WeightedRanking> {
  const tickets = await ticketsInScope(db, projectId, options.tags);
  const weights = withOverrides(await getWeights(db, projectId), options.weights);
  const { w1, w2, w3, w4 } = weights;
  validateWeights(w1, w2, w3, w4);

  const exact = (t: Ticket) => exactWeightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4);
  return {
    weights,
    tickets: [...tickets]
      .sort((a, b) => exact(b) - exact(a))
      .map((t) => ({
        title: t.title,
        priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
        weighted: weightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4),
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
  const { w1, w2, w3, w4 } = withOverrides(await getWeights(db, projectId), overrides);
  return setWeights(db, projectId, w1, w2, w3, w4);
}
