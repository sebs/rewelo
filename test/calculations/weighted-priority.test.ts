import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../src/errors.js";
import { weightedPriority } from "../../src/calculations/weighted-priority.js";

describe("weighted priority", () => {
  it("with equal weights matches basic priority", () => {
    assert.equal(weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 1.5, w2: 1.5, w3: 1.5, w4: 1.5 }), 2.6);
  });

  it("emphasising benefit", () => {
    // (3*8 + 1*5) / (1.5*3 + 1.5*2) = 29/7.5 = 3.87
    assert.equal(weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 3, w2: 1, w3: 1.5, w4: 1.5 }), 3.87);
  });

  it("emphasising risk", () => {
    // (1.5*8 + 1.5*5) / (1*3 + 3*2) = 19.5/9 = 2.17
    assert.equal(weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 1.5, w2: 1.5, w3: 1, w4: 3 }), 2.17);
  });

  it("throws AppError on zero denominator", () => {
    assert.throws(() => weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 1.5, w2: 1.5, w3: 0, w4: 0 }), AppError);
    assert.throws(() => weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 1.5, w2: 1.5, w3: 0, w4: 0 }), /denominator is zero/);
  });

  it("throws AppError when all weights are zero", () => {
    assert.throws(() => weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 0, w2: 0, w3: 0, w4: 0 }), AppError);
    assert.throws(() => weightedPriority({ benefit: 8, penalty: 5, estimate: 3, risk: 2 }, { w1: 0, w2: 0, w3: 0, w4: 0 }), /denominator is zero/);
  });

  it("rounds halves up despite float error", () => {
    // (2.5*3 + 13) / (0.5*1 + 1.5*13) = 20.5 / 20 = 1.025
    assert.equal(weightedPriority({ benefit: 3, penalty: 13, estimate: 1, risk: 13 }, { w1: 2.5, w2: 1, w3: 0.5, w4: 1.5 }), 1.03);
    // (1.1*1 + 1.3*5) / (0.7*2 + 0.9*2) = 7.6 / 3.2 = 2.375
    assert.equal(weightedPriority({ benefit: 1, penalty: 5, estimate: 2, risk: 2 }, { w1: 1.1, w2: 1.3, w3: 0.7, w4: 0.9 }), 2.38);
  });
});
