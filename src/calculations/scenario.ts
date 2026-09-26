import { round2 } from "./priority.js";
import { exactWeightedPriority, weightedPriority } from "./weighted-priority.js";
import { AppError } from "../errors.js";
import { collapseSpaces, normalizeName } from "../text.js";
import { validateWeights, withOverrides, type Weights } from "../domain/weights.js";
import { DIMENSIONS, FIBONACCI, type Dimension, type Scores } from "../domain/scores.js";

// What-if calculations for agents: the ranking under hypothetical scores,
// tickets and weights, computed here so a model doesn't do the arithmetic.
// Nothing is written.

export interface Scored extends Scores {
  title: string;
}

/** Highest weighted priority first; ties keep the given order, as calc_priority does */
export function rank<T extends Scored>(tickets: T[], w: Weights): T[] {
  const priorities = new Map(tickets.map((t) => [t, exactWeightedPriority(t, w)]));
  return [...tickets].sort((a, b) => priorities.get(b)! - priorities.get(a)!);
}

export interface Scenario {
  changes?: Array<{ title: string } & Partial<Record<Dimension, number>>>;
  add?: Array<{ title: string } & Partial<Record<Dimension, number>>>;
  remove?: string[];
  weights?: Partial<Weights>;
}

export interface ScenarioRow<C extends string = "scores" | "added" | "removed"> {
  title: string;
  baselineRank: number | null;
  scenarioRank: number | null;
  /** Positions moved up (negative: down); null for added and removed tickets */
  rankChange: number | null;
  baselinePriority: number | null;
  scenarioPriority: number | null;
  /** How the scenario touches this ticket itself, if it does */
  change?: C;
}

export interface RankingComparison<C extends string> {
  /** Tickets in the scenario's ranking */
  total: number;
  /** Tickets whose rank changed, not counting added and removed ones */
  moved: number;
  top: Array<{ rank: number; title: string; priority: number }>;
  /** The tickets the scenario touches, and every one that moved: scenario order, removed ones last */
  tickets: ScenarioRow<C>[];
}

export interface ScenarioResult extends RankingComparison<"scores" | "added" | "removed"> {
  baselineWeights: Weights;
  scenarioWeights: Weights;
}

/**
 * Two rankings of one backlog, compared: key says which tickets are the
 * same one, changes how the scenario touched a ticket itself
 */
export function compareRankings<T extends Scored, K, C extends string>(
  baseline: { tickets: T[]; weights: Weights },
  scenario: { tickets: T[]; weights: Weights },
  key: (t: T) => K,
  changes: Map<K, C>,
  options: { top: number; limit: number }
): RankingComparison<C> {
  const before = rank(baseline.tickets, baseline.weights);
  const after = rank(scenario.tickets, scenario.weights);
  const baselineRank = new Map(before.map((t, i) => [key(t), i + 1]));
  const scenarioRank = new Map(after.map((t, i) => [key(t), i + 1]));
  const original = new Map(before.map((t) => [key(t), t]));

  const row = (t: T): ScenarioRow<C> => {
    const k = key(t);
    const was = baselineRank.get(k) ?? null;
    const now = scenarioRank.get(k) ?? null;
    const change = changes.get(k);
    const old = original.get(k);
    return {
      title: t.title,
      baselineRank: was,
      scenarioRank: now,
      rankChange: was !== null && now !== null ? was - now : null,
      baselinePriority: old ? weightedPriority(old, baseline.weights) : null,
      scenarioPriority: now !== null ? weightedPriority(t, scenario.weights) : null,
      ...(change ? { change } : {}),
    };
  };
  const rows = after
    .map(row)
    .concat(before.filter((t) => !scenarioRank.has(key(t))).map(row))
    .filter((r) => r.change !== undefined || r.rankChange !== 0);

  return {
    total: after.length,
    moved: rows.filter((r) => r.rankChange !== null && r.rankChange !== 0).length,
    top: after.slice(0, options.top).map((t, i) => ({ rank: i + 1, title: t.title, priority: weightedPriority(t, scenario.weights) })),
    tickets: rows.slice(0, options.limit),
  };
}

/**
 * The ticket with this title, found as getTicketByTitle finds it: trimmed
 * and NFC, and with runs of spaces collapsed unless a ticket has the exact form
 */
export function findTicket<T extends Scored>(tickets: T[], title: string): T | undefined {
  const exact = normalizeName(title);
  return tickets.find((t) => t.title === exact) ?? tickets.find((t) => t.title === collapseSpaces(exact));
}

/**
 * The ranking of `tickets` under a scenario. `existing` are all the
 * project's tickets, which an added ticket's title must not clash with,
 * also those not ranked (outside a tag scope, done)
 */
export function simulate(
  tickets: Scored[],
  baselineWeights: Weights,
  scenario: Scenario,
  options: { top: number; limit: number },
  existing: Scored[] = tickets
): ScenarioResult {
  const byTitle = new Map(tickets.map((t) => [t.title, t]));
  // Titles as given, matched to the stored ones
  const stored = (title: string) => {
    const ticket = findTicket(tickets, title);
    if (!ticket) throw new AppError(`Ticket "${title}" not found`);
    return ticket.title;
  };
  const removed = new Set((scenario.remove ?? []).map(stored));
  const changed = new Map<string, Scored>();
  for (const change of scenario.changes ?? []) {
    const title = stored(change.title);
    if (removed.has(title)) throw new AppError(`Ticket "${change.title}" is both changed and removed`);
    if (changed.has(title)) throw new AppError(`Ticket "${change.title}" is changed twice`);
    changed.set(title, { ...byTitle.get(title)!, ...definedScores(change) });
  }
  const added: Scored[] = [];
  for (const t of scenario.add ?? []) {
    // As a new ticket's title is stored
    const title = collapseSpaces(normalizeName(t.title));
    if (findTicket(existing, title)) throw new AppError(`A ticket with title "${t.title}" already exists`);
    if (added.some((a) => a.title === title)) throw new AppError(`Ticket "${t.title}" is added twice`);
    added.push({ title, benefit: 1, penalty: 1, estimate: 1, risk: 1, ...definedScores(t) });
  }
  const scenarioWeights = withOverrides(baselineWeights, scenario.weights);
  validateWeights(scenarioWeights);

  const changes = new Map<string, "scores" | "added" | "removed">([
    ...[...changed.keys()].map((title) => [title, "scores"] as const),
    ...added.map((t) => [t.title, "added"] as const),
    ...[...removed].map((title) => [title, "removed"] as const),
  ]);
  return {
    baselineWeights,
    scenarioWeights,
    ...compareRankings(
      { tickets, weights: baselineWeights },
      { tickets: tickets.filter((t) => !removed.has(t.title)).map((t) => changed.get(t.title) ?? t).concat(added), weights: scenarioWeights },
      (t) => t.title,
      changes,
      options
    ),
  };
}

export interface Explanation {
  title: string;
  scores: Record<Dimension, number>;
  weights: Weights;
  /** w1 × benefit + w2 × penalty */
  weightedValue: number;
  /** w3 × estimate + w4 × risk */
  weightedCost: number;
  formula: string;
  priority: number;
  rank: number;
  of: number;
  target: {
    top: number;
    reached: boolean;
    /** Priority of the ticket that holds rank `top` now, which this one has to beat */
    priorityToBeat: number | null;
    /** The smallest change of one score that reaches the target, per score where one does */
    options: Array<{ dimension: Dimension; from: number; to: number; priority: number; rank: number }>;
  };
}

export function explain(tickets: Scored[], weights: Weights, title: string, top: number): Explanation {
  const ticket = findTicket(tickets, title);
  if (!ticket) throw new AppError(`Ticket "${title}" not found`);
  const rankOf = (variant: Scored) => rank(tickets.map((t) => (t === ticket ? variant : t)), weights).indexOf(variant) + 1;
  const current = rankOf(ticket);
  const { w1, w2, w3, w4 } = weights;
  const weightedValue = w1 * ticket.benefit + w2 * ticket.penalty;
  const weightedCost = w3 * ticket.estimate + w4 * ticket.risk;
  const priority = weightedPriority(ticket, weights);
  const others = rank(tickets.filter((t) => t !== ticket), weights);
  const rival = others[top - 1];

  const options: Explanation["target"]["options"] = [];
  if (current > top) {
    for (const dimension of DIMENSIONS) {
      const from = ticket[dimension];
      // Raise value, lower cost: the nearest Fibonacci value first
      const candidates = dimension === "benefit" || dimension === "penalty"
        ? FIBONACCI.filter((v) => v > from)
        : FIBONACCI.filter((v) => v < from).reverse();
      for (const to of candidates) {
        const variant = { ...ticket, [dimension]: to };
        const r = rankOf(variant);
        if (r <= top) {
          options.push({ dimension, from, to, priority: weightedPriority(variant, weights), rank: r });
          break;
        }
      }
    }
  }

  return {
    title: ticket.title,
    scores: { benefit: ticket.benefit, penalty: ticket.penalty, estimate: ticket.estimate, risk: ticket.risk },
    weights,
    weightedValue: round2(weightedValue),
    weightedCost: round2(weightedCost),
    formula: `(${w1} × ${ticket.benefit} + ${w2} × ${ticket.penalty}) / (${w3} × ${ticket.estimate} + ${w4} × ${ticket.risk}) = ${round2(weightedValue)} / ${round2(weightedCost)} = ${priority}`,
    priority,
    rank: current,
    of: tickets.length,
    target: {
      top,
      reached: current <= top,
      priorityToBeat: current > top && rival ? weightedPriority(rival, weights) : null,
      options,
    },
  };
}

function definedScores(input: Partial<Record<Dimension, number>>): Partial<Record<Dimension, number>> {
  const out: Partial<Record<Dimension, number>> = {};
  for (const d of DIMENSIONS) if (input[d] !== undefined) out[d] = input[d];
  return out;
}
