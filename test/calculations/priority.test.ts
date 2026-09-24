import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { value, cost, priority } from "../../src/calculations/priority.js";

describe("priority calculations", () => {
  it("value is benefit plus penalty", () => {
    assert.equal(value(8, 5), 13);
  });

  it("cost is estimate plus risk", () => {
    assert.equal(cost(3, 2), 5);
  });

  it("priority is value divided by cost", () => {
    assert.equal(priority(8, 5, 3, 2), 2.6);
  });

  it("priority with high cost", () => {
    assert.equal(priority(1, 1, 13, 8), 0.1);
  });

  it("priority with minimum values", () => {
    assert.equal(priority(1, 1, 1, 1), 1);
  });

  it("priority with maximum values", () => {
    assert.equal(priority(21, 21, 21, 21), 1);
  });
});
