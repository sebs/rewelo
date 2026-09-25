import { round2 } from "./priority.js";
import { exactWeightedPriority } from "./weighted-priority.js";
import { AppError } from "../validation/strings.js";
import { validateWeights } from "../weights/repository.js";

// What-if calculations for agents: the ranking under hypothetical scores,
// tickets and weights, computed here so a model doesn't do the arithmetic.
// Nothing is written.

export interface Weights {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

export interface Scored {
  title: string;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
}

type Dimension = "benefit" | "penalty" | "estimate" | "risk";

const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

const exact = (t: Scored, w: Weights) => exactWeightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w.w1, w.w2, w.w3, w.w4);

/** Highest weighted priority first; ties keep the given order, as calc_priority does */
export function rank<T extends Scored>(tickets: T[], w: Weights): T[] {
  const priorities = new Map(tickets.map((t) => [t, exact(t, w)]));
  return [...tickets].sort((a, b) => priorities.get(b)! - priorities.get(a)!);
}

export interface Scenario {
  changes?: Array<{ title: string } & Partial<Record<Dimension, number>>>;
  add?: Array<{ title: string } & Partial<Record<Dimension, number>>>;
  remove?: string[];
  weights?: Partial<Weights>;
}

export interface ScenarioRow {
  title: string;
  baselineRank: number | null;
  scenarioRank: number | null;
  /** Positions moved up (negative: down); null for added and removed tickets */
  rankChange: number | null;
  baselinePriority: number | null;
  scenarioPriority: number | null;
  /** How the scenario touches this ticket itself, if it does */
  change?: "scores" | "added" | "removed";
}

export interface ScenarioResult {
  baselineWeights: Weights;
  scenarioWeights: Weights;
  /** Tickets in the scenario's ranking */
  total: number;
  /** Tickets whose rank changed, not counting added and removed ones */
  moved: number;
  top: Array<{ rank: number; title: string; priority: number }>;
  /** The tickets the scenario changes, adds or removes, and every one that moved: scenario order, removed ones last */
  tickets: ScenarioRow[];
}

export function simulate(tickets: Scored[], baselineWeights: Weights, scenario: Scenario, options: { top: number; limit: number }): ScenarioResult {
  const byTitle = new Map(tickets.map((t) => [t.title, t]));
  const mustExist = (title: string) => {
    if (!byTitle.has(title)) throw new AppError(`Ticket "${title}" not found`);
  };
  const removed = new Set(scenario.remove ?? []);
  removed.forEach(mustExist);
  const changed = new Map<string, Scored>();
  for (const change of scenario.changes ?? []) {
    mustExist(change.title);
    if (removed.has(change.title)) throw new AppError(`Ticket "${change.title}" is both changed and removed`);
    if (changed.has(change.title)) throw new AppError(`Ticket "${change.title}" is changed twice`);
    changed.set(change.title, { ...byTitle.get(change.title)!, ...definedScores(change) });
  }
  const added: Scored[] = [];
  for (const t of scenario.add ?? []) {
    if (byTitle.has(t.title) || added.some((a) => a.title === t.title)) throw new AppError(`A ticket with title "${t.title}" already exists`);
    added.push({ title: t.title, benefit: 1, penalty: 1, estimate: 1, risk: 1, ...definedScores(t) });
  }
  const scenarioWeights = { ...baselineWeights, ...definedWeights(scenario.weights) };
  validateWeights(scenarioWeights.w1, scenarioWeights.w2, scenarioWeights.w3, scenarioWeights.w4);

  const baseline = rank(tickets, baselineWeights);
  const after = rank(
    tickets.filter((t) => !removed.has(t.title)).map((t) => changed.get(t.title) ?? t).concat(added),
    scenarioWeights
  );
  const baselineRank = new Map(baseline.map((t, i) => [t.title, i + 1]));
  const scenarioRank = new Map(after.map((t, i) => [t.title, i + 1]));
  const addedTitles = new Set(added.map((t) => t.title));

  const row = (t: Scored, change: ScenarioRow["change"]): ScenarioRow => {
    const before = baselineRank.get(t.title) ?? null;
    const now = scenarioRank.get(t.title) ?? null;
    const original = byTitle.get(t.title);
    return {
      title: t.title,
      baselineRank: before,
      scenarioRank: now,
      rankChange: before !== null && now !== null ? before - now : null,
      baselinePriority: original ? round2(exact(original, baselineWeights)) : null,
      scenarioPriority: now !== null ? round2(exact(t, scenarioWeights)) : null,
      ...(change ? { change } : {}),
    };
  };
  const rows = after
    .map((t) => row(t, addedTitles.has(t.title) ? "added" : changed.has(t.title) ? "scores" : undefined))
    .concat(baseline.filter((t) => removed.has(t.title)).map((t) => row(t, "removed")))
    .filter((r) => r.change !== undefined || r.rankChange !== 0);

  return {
    baselineWeights,
    scenarioWeights,
    total: after.length,
    moved: rows.filter((r) => r.rankChange !== null && r.rankChange !== 0).length,
    top: after.slice(0, options.top).map((t, i) => ({ rank: i + 1, title: t.title, priority: round2(exact(t, scenarioWeights)) })),
    tickets: rows.slice(0, options.limit),
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
  const ticket = tickets.find((t) => t.title === title);
  if (!ticket) throw new AppError(`Ticket "${title}" not found`);
  const rankOf = (variant: Scored) => rank(tickets.map((t) => (t === ticket ? variant : t)), weights).indexOf(variant) + 1;
  const current = rankOf(ticket);
  const { w1, w2, w3, w4 } = weights;
  const weightedValue = w1 * ticket.benefit + w2 * ticket.penalty;
  const weightedCost = w3 * ticket.estimate + w4 * ticket.risk;
  const priority = round2(exact(ticket, weights));
  const others = rank(tickets.filter((t) => t !== ticket), weights);
  const rival = others[top - 1];

  const options: Explanation["target"]["options"] = [];
  if (current > top) {
    for (const dimension of ["benefit", "penalty", "estimate", "risk"] as const) {
      const from = ticket[dimension];
      // Raise value, lower cost: the nearest Fibonacci value first
      const candidates = dimension === "benefit" || dimension === "penalty"
        ? FIBONACCI.filter((v) => v > from)
        : FIBONACCI.filter((v) => v < from).reverse();
      for (const to of candidates) {
        const variant = { ...ticket, [dimension]: to };
        const r = rankOf(variant);
        if (r <= top) {
          options.push({ dimension, from, to, priority: round2(exact(variant, weights)), rank: r });
          break;
        }
      }
    }
  }

  return {
    title,
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
      priorityToBeat: current > top && rival ? round2(exact(rival, weights)) : null,
      options,
    },
  };
}

function definedScores(input: Partial<Record<Dimension, number>>): Partial<Record<Dimension, number>> {
  const out: Partial<Record<Dimension, number>> = {};
  for (const d of ["benefit", "penalty", "estimate", "risk"] as const) if (input[d] !== undefined) out[d] = input[d];
  return out;
}

function definedWeights(input: Partial<Weights> | undefined): Partial<Weights> {
  const out: Partial<Weights> = {};
  for (const w of ["w1", "w2", "w3", "w4"] as const) if (input?.[w] !== undefined) out[w] = input[w];
  return out;
}
