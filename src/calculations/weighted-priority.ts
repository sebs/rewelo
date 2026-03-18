import { AppError } from "../validation/strings.js";

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
  const numerator = w1 * benefit + w2 * penalty;
  const denominator = w3 * estimate + w4 * risk;

  if (denominator === 0) {
    throw new AppError("Weighted priority denominator is zero: w3*estimate + w4*risk = 0");
  }

  return Math.round((numerator / denominator) * 100) / 100;
}
