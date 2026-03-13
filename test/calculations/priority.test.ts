import { describe, it, expect } from "vitest";
import { value, cost, priority } from "../../src/calculations/priority.js";

describe("priority calculations", () => {
  it("value is benefit plus penalty", () => {
    expect(value(8, 5)).toBe(13);
  });

  it("cost is estimate plus risk", () => {
    expect(cost(3, 2)).toBe(5);
  });

  it("priority is value divided by cost", () => {
    expect(priority(8, 5, 3, 2)).toBe(2.6);
  });

  it("priority with high cost", () => {
    expect(priority(1, 1, 13, 8)).toBe(0.1);
  });

  it("priority with minimum values", () => {
    expect(priority(1, 1, 1, 1)).toBe(1);
  });

  it("priority with maximum values", () => {
    expect(priority(21, 21, 21, 21)).toBe(1);
  });
});
