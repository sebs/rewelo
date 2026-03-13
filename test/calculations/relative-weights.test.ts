import { describe, it, expect } from "vitest";
import {
  calculateRelativeWeights,
  Scoreable,
} from "../../src/calculations/relative-weights.js";

describe("relative weight calculations", () => {
  const stories: Scoreable[] = [
    { benefit: 8, penalty: 5, estimate: 3, risk: 2 },
    { benefit: 2, penalty: 1, estimate: 5, risk: 3 },
    { benefit: 5, penalty: 3, estimate: 2, risk: 1 },
  ];

  it("calculates relative benefit", () => {
    expect(calculateRelativeWeights(stories[0], stories).relativeBenefit).toBe(0.53);
    expect(calculateRelativeWeights(stories[1], stories).relativeBenefit).toBe(0.13);
    expect(calculateRelativeWeights(stories[2], stories).relativeBenefit).toBe(0.33);
  });

  it("calculates relative penalty", () => {
    const s: Scoreable[] = [
      { benefit: 3, penalty: 8, estimate: 2, risk: 1 },
      { benefit: 5, penalty: 2, estimate: 3, risk: 2 },
    ];
    expect(calculateRelativeWeights(s[0], s).relativePenalty).toBe(0.8);
    expect(calculateRelativeWeights(s[1], s).relativePenalty).toBe(0.2);
  });

  it("calculates relative estimate", () => {
    const s: Scoreable[] = [
      { benefit: 3, penalty: 2, estimate: 13, risk: 1 },
      { benefit: 5, penalty: 3, estimate: 8, risk: 2 },
    ];
    expect(calculateRelativeWeights(s[0], s).relativeEstimate).toBe(0.62);
    expect(calculateRelativeWeights(s[1], s).relativeEstimate).toBe(0.38);
  });

  it("calculates relative risk", () => {
    const s: Scoreable[] = [
      { benefit: 3, penalty: 2, estimate: 5, risk: 13 },
      { benefit: 5, penalty: 3, estimate: 3, risk: 8 },
    ];
    expect(calculateRelativeWeights(s[0], s).relativeRisk).toBe(0.62);
    expect(calculateRelativeWeights(s[1], s).relativeRisk).toBe(0.38);
  });

  it("single ticket has all relative weights = 1.0", () => {
    const single: Scoreable[] = [{ benefit: 5, penalty: 3, estimate: 2, risk: 1 }];
    const rw = calculateRelativeWeights(single[0], single);
    expect(rw.relativeBenefit).toBe(1);
    expect(rw.relativePenalty).toBe(1);
    expect(rw.relativeEstimate).toBe(1);
    expect(rw.relativeRisk).toBe(1);
  });

  it("handles empty list gracefully", () => {
    const rw = calculateRelativeWeights(
      { benefit: 5, penalty: 3, estimate: 2, risk: 1 },
      []
    );
    expect(rw.relativeBenefit).toBe(0);
  });
});
