export function value(benefit: number, penalty: number): number {
  return benefit + penalty;
}

export function cost(estimate: number, risk: number): number {
  return estimate + risk;
}

export function priority(
  benefit: number,
  penalty: number,
  estimate: number,
  risk: number
): number {
  const c = cost(estimate, risk);
  return Math.round((value(benefit, penalty) / c) * 100) / 100;
}
