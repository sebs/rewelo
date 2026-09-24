import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAllRelativeWeights,
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
    assert.equal(calculateRelativeWeights(stories[0], stories).relativeBenefit, 0.5333);
    assert.equal(calculateRelativeWeights(stories[1], stories).relativeBenefit, 0.1333);
    assert.equal(calculateRelativeWeights(stories[2], stories).relativeBenefit, 0.3333);
  });

  it("calculates relative penalty", () => {
    const s: Scoreable[] = [
      { benefit: 3, penalty: 8, estimate: 2, risk: 1 },
      { benefit: 5, penalty: 2, estimate: 3, risk: 2 },
    ];
    assert.equal(calculateRelativeWeights(s[0], s).relativePenalty, 0.8);
    assert.equal(calculateRelativeWeights(s[1], s).relativePenalty, 0.2);
  });

  it("calculates relative estimate", () => {
    const s: Scoreable[] = [
      { benefit: 3, penalty: 2, estimate: 13, risk: 1 },
      { benefit: 5, penalty: 3, estimate: 8, risk: 2 },
    ];
    assert.equal(calculateRelativeWeights(s[0], s).relativeEstimate, 0.619);
    assert.equal(calculateRelativeWeights(s[1], s).relativeEstimate, 0.381);
  });

  it("calculates relative risk", () => {
    const s: Scoreable[] = [
      { benefit: 3, penalty: 2, estimate: 5, risk: 13 },
      { benefit: 5, penalty: 3, estimate: 3, risk: 8 },
    ];
    assert.equal(calculateRelativeWeights(s[0], s).relativeRisk, 0.619);
    assert.equal(calculateRelativeWeights(s[1], s).relativeRisk, 0.381);
  });

  it("single ticket has all relative weights = 1.0", () => {
    const single: Scoreable[] = [{ benefit: 5, penalty: 3, estimate: 2, risk: 1 }];
    const rw = calculateRelativeWeights(single[0], single);
    assert.equal(rw.relativeBenefit, 1);
    assert.equal(rw.relativePenalty, 1);
    assert.equal(rw.relativeEstimate, 1);
    assert.equal(rw.relativeRisk, 1);
  });

  it("handles empty list gracefully", () => {
    const rw = calculateRelativeWeights(
      { benefit: 5, penalty: 3, estimate: 2, risk: 1 },
      []
    );
    assert.equal(rw.relativeBenefit, 0);
  });

  it("computes every ticket's weights in one pass with the same results", () => {
    const all = calculateAllRelativeWeights(stories);
    stories.forEach((t, i) => assert.deepEqual(all[i], { ...t, ...calculateRelativeWeights(t, stories) }));

    // Linear, not quadratic: 8x the tickets must take far less than the 64x
    // a quadratic pass needs (a ratio, so the check holds on a busy machine
    // too; best of 5)
    const time = (n: number) => {
      const tickets = Array.from({ length: n }, () => ({ benefit: 5, penalty: 1, estimate: 1, risk: 1 }));
      let best = Infinity;
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        calculateAllRelativeWeights(tickets);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const ratio = time(40_000) / Math.max(time(5_000), 0.5);
    assert.ok(ratio < 32, `8x the tickets took ${ratio.toFixed(1)}x as long`);
  });

  it("keeps small shares in large backlogs instead of rounding them to 0", () => {
    const many = Array.from({ length: 20_000 }, () => ({ benefit: 5, penalty: 1, estimate: 1, risk: 1 }));
    assert.equal(calculateAllRelativeWeights(many)[0].relativeBenefit, 0.00005);
  });
});
