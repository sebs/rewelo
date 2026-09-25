import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateAllRelativeWeights,
} from "../../src/calculations/relative-weights.js";
import type { Scores } from "../../src/domain/scores.js";

describe("relative weight calculations", () => {
  const stories: Scores[] = [
    { benefit: 8, penalty: 5, estimate: 3, risk: 2 },
    { benefit: 2, penalty: 1, estimate: 5, risk: 3 },
    { benefit: 5, penalty: 3, estimate: 2, risk: 1 },
  ];

  it("calculates relative benefit", () => {
    assert.equal(calculateAllRelativeWeights(stories)[0].relativeBenefit, 0.5333);
    assert.equal(calculateAllRelativeWeights(stories)[1].relativeBenefit, 0.1333);
    assert.equal(calculateAllRelativeWeights(stories)[2].relativeBenefit, 0.3333);
  });

  it("calculates relative penalty", () => {
    const s: Scores[] = [
      { benefit: 3, penalty: 8, estimate: 2, risk: 1 },
      { benefit: 5, penalty: 2, estimate: 3, risk: 2 },
    ];
    assert.equal(calculateAllRelativeWeights(s)[0].relativePenalty, 0.8);
    assert.equal(calculateAllRelativeWeights(s)[1].relativePenalty, 0.2);
  });

  it("calculates relative estimate", () => {
    const s: Scores[] = [
      { benefit: 3, penalty: 2, estimate: 13, risk: 1 },
      { benefit: 5, penalty: 3, estimate: 8, risk: 2 },
    ];
    assert.equal(calculateAllRelativeWeights(s)[0].relativeEstimate, 0.619);
    assert.equal(calculateAllRelativeWeights(s)[1].relativeEstimate, 0.381);
  });

  it("calculates relative risk", () => {
    const s: Scores[] = [
      { benefit: 3, penalty: 2, estimate: 5, risk: 13 },
      { benefit: 5, penalty: 3, estimate: 3, risk: 8 },
    ];
    assert.equal(calculateAllRelativeWeights(s)[0].relativeRisk, 0.619);
    assert.equal(calculateAllRelativeWeights(s)[1].relativeRisk, 0.381);
  });

  it("single ticket has all relative weights = 1.0", () => {
    const single: Scores[] = [{ benefit: 5, penalty: 3, estimate: 2, risk: 1 }];
    const rw = calculateAllRelativeWeights(single)[0];
    assert.equal(rw.relativeBenefit, 1);
    assert.equal(rw.relativePenalty, 1);
    assert.equal(rw.relativeEstimate, 1);
    assert.equal(rw.relativeRisk, 1);
  });

  it("handles empty list gracefully", () => {
    assert.deepEqual(calculateAllRelativeWeights([]), []);
  });

  it("computes every ticket's weights in one pass", () => {
    // Linear, not quadratic: count score reads instead of timing (timings
    // flaked on a busy machine). Summing once reads each ticket a few times;
    // re-summing per ticket reads every ticket for each ticket.
    let reads = 0;
    const counted = Array.from({ length: 1000 }, () => {
      const ticket = {} as Scores;
      for (const key of ["benefit", "penalty", "estimate", "risk"] as const) {
        Object.defineProperty(ticket, key, { enumerable: true, get: () => (reads++, 1) });
      }
      return ticket;
    });
    calculateAllRelativeWeights(counted);
    assert.ok(reads < 20 * counted.length, `${reads} score reads for ${counted.length} tickets`);
  });

  it("keeps small shares in large backlogs instead of rounding them to 0", () => {
    const many = Array.from({ length: 20_000 }, () => ({ benefit: 5, penalty: 1, estimate: 1, risk: 1 }));
    assert.equal(calculateAllRelativeWeights(many)[0].relativeBenefit, 0.00005);
  });
});
