import { round2 } from "./priority.js";
import { AppError } from "../errors.js";
import type { Scores } from "../domain/scores.js";
import type { Weights } from "../domain/weights.js";

/** Weighted value / weighted cost, unrounded: use it to sort */
export function exactWeightedPriority(s: Scores, w: Weights): number {
  const numerator = w.w1 * s.benefit + w.w2 * s.penalty;
  const denominator = w.w3 * s.estimate + w.w4 * s.risk;

  if (denominator === 0) {
    throw new AppError("Weighted priority denominator is zero: w3*estimate + w4*risk = 0");
  }

  return numerator / denominator;
}

/** Weighted priority rounded to two decimals, for display */
export function weightedPriority(s: Scores, w: Weights): number {
  return round2(exactWeightedPriority(s, w));
}
