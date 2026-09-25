import type { Scores } from "../domain/scores.js";

export function value(benefit: number, penalty: number): number {
  return benefit + penalty;
}

export function cost(estimate: number, risk: number): number {
  return estimate + risk;
}

/**
 * Round to two decimals, half up. The float error has to go first: 20.5/20
 * is stored as 1.0249999999999999, which Math.round would take to 1.02.
 * Fifteen significant digits drop that noise (doubles carry ~15.9) but keep
 * real digits: twelve turned 0.124999999999999 into 0.125 and then 0.13.
 */
export function round2(x: number): number {
  return Math.round(Number((x * 100).toPrecision(15))) / 100;
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
  return round2(exactPriority(benefit, penalty, estimate, risk));
}

/**
 * Sort comparator, highest priority first. Compares the exact ratio: 2/24
 * and 2/26 both display as 0.08 but are not equal.
 */
export function byPriority(a: Scores, b: Scores): number {
  return exactPriority(b.benefit, b.penalty, b.estimate, b.risk) - exactPriority(a.benefit, a.penalty, a.estimate, a.risk);
}
