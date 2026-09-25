import { AppError } from "../validation/strings.js";

// The weights w1..w4 of the weighted priority, without any storage: used by
// calculations and import parsing as well as by the repository.

export interface Weights {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

export const DEFAULT_WEIGHTS: Weights = { w1: 1.5, w2: 1.5, w3: 1.5, w4: 1.5 };

const MAX_WEIGHT = 100;
// A weight like 1e-22 makes weighted priorities astronomically large (2.1e+23)
// and prints as exponent notation; below 0.01 a weight is as good as 0.
const MIN_NONZERO_WEIGHT = 0.01;

export function validateWeights(w1: number, w2: number, w3: number, w4: number): void {
  for (const [name, val] of [["w1", w1], ["w2", w2], ["w3", w3], ["w4", w4]] as const) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
      throw new AppError(`Weight ${name} must be a non-negative number`);
    }
    if (val > MAX_WEIGHT) {
      throw new AppError(`Weight ${name} must not exceed ${MAX_WEIGHT}`);
    }
    if (val > 0 && val < MIN_NONZERO_WEIGHT) {
      throw new AppError(`Weight ${name} must be 0 or at least ${MIN_NONZERO_WEIGHT}`);
    }
  }
  if (w3 === 0 && w4 === 0) {
    throw new AppError("Cost weights w3 and w4 cannot both be zero (would cause division by zero in priority calculation)");
  }
}

/** The given weights in place of the current ones; undefined ones keep theirs */
export function withOverrides(current: Weights, overrides: Partial<Weights> = {}): Weights {
  return {
    w1: overrides.w1 ?? current.w1,
    w2: overrides.w2 ?? current.w2,
    w3: overrides.w3 ?? current.w3,
    w4: overrides.w4 ?? current.w4,
  };
}
