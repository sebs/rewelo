import { describe, it, expect } from "vitest";
import { weightedPriority } from "../../src/calculations/weighted-priority.js";

describe("weighted priority", () => {
  it("with equal weights matches basic priority", () => {
    expect(weightedPriority(8, 5, 3, 2, 1.5, 1.5, 1.5, 1.5)).toBe(2.6);
  });

  it("emphasising benefit", () => {
    // (3*8 + 1*5) / (1.5*3 + 1.5*2) = 29/7.5 = 3.87
    expect(weightedPriority(8, 5, 3, 2, 3, 1, 1.5, 1.5)).toBe(3.87);
  });

  it("emphasising risk", () => {
    // (1.5*8 + 1.5*5) / (1*3 + 3*2) = 19.5/9 = 2.17
    expect(weightedPriority(8, 5, 3, 2, 1.5, 1.5, 1, 3)).toBe(2.17);
  });

  it("throws on zero denominator", () => {
    expect(() => weightedPriority(8, 5, 3, 2, 1.5, 1.5, 0, 0)).toThrow(
      "denominator is zero"
    );
  });

  it("throws when all weights are zero", () => {
    expect(() => weightedPriority(8, 5, 3, 2, 0, 0, 0, 0)).toThrow(
      "denominator is zero"
    );
  });
});
