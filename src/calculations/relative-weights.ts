export interface Scoreable {
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
}

export interface RelativeWeights {
  relativeBenefit: number;
  relativePenalty: number;
  relativeEstimate: number;
  relativeRisk: number;
}

// Four significant digits rather than two decimals: in a backlog of a few
// hundred tickets each share is below 0.005 and would round to 0.
function safeRatio(value: number, total: number): number {
  if (total === 0) return 0;
  return Number((value / total).toPrecision(4));
}

function totals(all: Scoreable[]): Scoreable {
  const sum: Scoreable = { benefit: 0, penalty: 0, estimate: 0, risk: 0 };
  for (const t of all) {
    sum.benefit += t.benefit;
    sum.penalty += t.penalty;
    sum.estimate += t.estimate;
    sum.risk += t.risk;
  }
  return sum;
}

function relativeTo(ticket: Scoreable, sum: Scoreable): RelativeWeights {
  return {
    relativeBenefit: safeRatio(ticket.benefit, sum.benefit),
    relativePenalty: safeRatio(ticket.penalty, sum.penalty),
    relativeEstimate: safeRatio(ticket.estimate, sum.estimate),
    relativeRisk: safeRatio(ticket.risk, sum.risk),
  };
}

export function calculateRelativeWeights(
  ticket: Scoreable,
  all: Scoreable[]
): RelativeWeights {
  return relativeTo(ticket, totals(all));
}

/**
 * Relative weights of every ticket. Sums the backlog once: calling
 * calculateRelativeWeights per ticket is quadratic (minutes for 20,000 tickets).
 */
export function calculateAllRelativeWeights<T extends Scoreable>(
  all: T[]
): (T & RelativeWeights)[] {
  const sum = totals(all);
  return all.map((t) => ({ ...t, ...relativeTo(t, sum) }));
}
