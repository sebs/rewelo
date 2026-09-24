import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../src/validation/strings.js";
import { weightedPriority } from "../../src/calculations/weighted-priority.js";

describe("weighted priority", () => {
  it("with equal weights matches basic priority", () => {
    assert.equal(weightedPriority(8, 5, 3, 2, 1.5, 1.5, 1.5, 1.5), 2.6);
  });

  it("emphasising benefit", () => {
    // (3*8 + 1*5) / (1.5*3 + 1.5*2) = 29/7.5 = 3.87
    assert.equal(weightedPriority(8, 5, 3, 2, 3, 1, 1.5, 1.5), 3.87);
  });

  it("emphasising risk", () => {
    // (1.5*8 + 1.5*5) / (1*3 + 3*2) = 19.5/9 = 2.17
    assert.equal(weightedPriority(8, 5, 3, 2, 1.5, 1.5, 1, 3), 2.17);
  });

  it("throws AppError on zero denominator", () => {
    assert.throws(() => weightedPriority(8, 5, 3, 2, 1.5, 1.5, 0, 0), AppError);
    assert.throws(() => weightedPriority(8, 5, 3, 2, 1.5, 1.5, 0, 0), /denominator is zero/);
  });

  it("throws AppError when all weights are zero", () => {
    assert.throws(() => weightedPriority(8, 5, 3, 2, 0, 0, 0, 0), AppError);
    assert.throws(() => weightedPriority(8, 5, 3, 2, 0, 0, 0, 0), /denominator is zero/);
  });
});
