import { round2 } from "./priority.js";
import { AppError } from "../validation/strings.js";

/** Weighted value / weighted cost, unrounded: use it to sort */
export function exactWeightedPriority(
  benefit: number,
  penalty: number,
  estimate: number,
  risk: number,
  w1: number,
  w2: number,
  w3: number,
  w4: number
): number {
  const numerator = w1 * benefit + w2 * penalty;
  const denominator = w3 * estimate + w4 * risk;

  if (denominator === 0) {
    throw new AppError("Weighted priority denominator is zero: w3*estimate + w4*risk = 0");
  }

  return numerator / denominator;
}

/** Weighted priority rounded to two decimals, for display */
export function weightedPriority(
  benefit: number,
  penalty: number,
  estimate: number,
  risk: number,
  w1: number,
  w2: number,
  w3: number,
  w4: number
): number {
  return round2(exactWeightedPriority(benefit, penalty, estimate, risk, w1, w2, w3, w4));
}
