export function value(benefit: number, penalty: number): number {
  return benefit + penalty;
}

export function cost(estimate: number, risk: number): number {
  return estimate + risk;
}

/** value / cost, unrounded: use it to sort and filter */
export function exactPriority(
  benefit: number,
  penalty: number,
  estimate: number,
  risk: number
): number {
  return value(benefit, penalty) / cost(estimate, risk);
}

/** value / cost rounded to two decimals, for display */
export function priority(
  benefit: number,
  penalty: number,
  estimate: number,
  risk: number
): number {
  return Math.round(exactPriority(benefit, penalty, estimate, risk) * 100) / 100;
}

interface Scores {
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
}

/**
 * Sort comparator, highest priority first. Compares the exact ratio: 2/24
 * and 2/26 both display as 0.08 but are not equal.
 */
export function byPriority(a: Scores, b: Scores): number {
  return exactPriority(b.benefit, b.penalty, b.estimate, b.risk) - exactPriority(a.benefit, a.penalty, a.estimate, a.risk);
}
