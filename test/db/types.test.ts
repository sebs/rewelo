import { describe, it, expect } from "vitest";
import { isFibonacci, assertFibonacci } from "../../src/db/types.js";

describe("Fibonacci validation", () => {
  it.each([1, 2, 3, 5, 8, 13, 21])("accepts %d as valid", (n) => {
    expect(isFibonacci(n)).toBe(true);
  });

  it.each([0, 4, 6, 7, 9, 10, 14, 15, 20, 22, -1])(
    "rejects %d as invalid",
    (n) => {
      expect(isFibonacci(n)).toBe(false);
    }
  );

  it("assertFibonacci throws for invalid values", () => {
    expect(() => assertFibonacci(4, "benefit")).toThrow(
      "benefit must be a Fibonacci value"
    );
  });

  it("assertFibonacci does not throw for valid values", () => {
    expect(() => assertFibonacci(8, "estimate")).not.toThrow();
  });
});
