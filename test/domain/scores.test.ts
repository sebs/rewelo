import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFibonacci, assertFibonacci } from "../../src/domain/scores.js";

describe("Fibonacci validation", () => {
  for (const n of [1, 2, 3, 5, 8, 13, 21]) {
    it(`accepts ${n} as valid`, () => {
      assert.equal(isFibonacci(n), true);
    });
  }

  for (const n of [0, 4, 6, 7, 9, 10, 14, 15, 20, 22, -1]) {
    it(`rejects ${n} as invalid`, () => {
      assert.equal(isFibonacci(n), false);
    });
  }

  it("assertFibonacci throws for invalid values", () => {
    assert.throws(() => assertFibonacci(4, "benefit"), /benefit must be a Fibonacci value/);
  });

  it("assertFibonacci does not throw for valid values", () => {
    assert.doesNotThrow(() => assertFibonacci(8, "estimate"));
  });
});
