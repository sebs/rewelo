import { AppError } from "../validation/strings.js";

// A ticket's four scores and the values they take, without any storage.

/** The values a score takes */
export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21] as const;
export type Fibonacci = (typeof FIBONACCI)[number];

/** The four scores: value is benefit + penalty, cost is estimate + risk */
export const DIMENSIONS = ["benefit", "penalty", "estimate", "risk"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type Scores = Record<Dimension, number>;

export function isFibonacci(n: number): n is Fibonacci {
  return FIBONACCI.includes(n as Fibonacci);
}

export function assertFibonacci(n: number, field: string): asserts n is Fibonacci {
  if (!isFibonacci(n)) {
    throw new AppError(`${field} must be a Fibonacci value (${FIBONACCI.join(", ")}), got ${n}`);
  }
}

/** Every score given is a Fibonacci value (checked in the order of DIMENSIONS) */
export function assertScores(scores: Partial<Scores>): void {
  for (const d of DIMENSIONS) {
    const n = scores[d];
    if (n !== undefined) assertFibonacci(n, d);
  }
}
