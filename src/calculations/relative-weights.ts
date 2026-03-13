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

function safeRatio(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100) / 100;
}

export function calculateRelativeWeights(
  ticket: Scoreable,
  all: Scoreable[]
): RelativeWeights {
  const sumBenefit = all.reduce((s, t) => s + t.benefit, 0);
  const sumPenalty = all.reduce((s, t) => s + t.penalty, 0);
  const sumEstimate = all.reduce((s, t) => s + t.estimate, 0);
  const sumRisk = all.reduce((s, t) => s + t.risk, 0);

  return {
    relativeBenefit: safeRatio(ticket.benefit, sumBenefit),
    relativePenalty: safeRatio(ticket.penalty, sumPenalty),
    relativeEstimate: safeRatio(ticket.estimate, sumEstimate),
    relativeRisk: safeRatio(ticket.risk, sumRisk),
  };
}
