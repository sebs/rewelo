import { describe, it, expect } from "vitest";
import { sanitizeError } from "../../src/validation/errors.js";
import { AppError, ValidationError } from "../../src/validation/strings.js";

describe("sanitizeError", () => {
  it("passes through ValidationError messages", () => {
    const err = new ValidationError("Project name must not be empty");
    expect(sanitizeError(err)).toBe("Project name must not be empty");
  });

  it("passes through AppError messages", () => {
    expect(sanitizeError(new AppError("Ticket not found"))).toBe("Ticket not found");
    expect(sanitizeError(new AppError("Tag not found"))).toBe("Tag not found");
    expect(sanitizeError(new AppError("benefit must be a Fibonacci number"))).toContain("Fibonacci");
    expect(sanitizeError(new AppError("denominator is zero"))).toContain("denominator is zero");
  });

  it("hides database errors from user", () => {
    const dbErr = new Error("Catalog Error: Table with name 'rw.projects' does not exist!");
    expect(sanitizeError(dbErr)).toBe("An internal error occurred. Please try again.");
  });

  it("hides SQL details from user", () => {
    const sqlErr = new Error("Parser Error: syntax error at or near 'SELECT'");
    expect(sanitizeError(sqlErr)).toBe("An internal error occurred. Please try again.");
  });

  it("handles non-Error objects", () => {
    expect(sanitizeError("string error")).toBe("An unexpected error occurred.");
    expect(sanitizeError(42)).toBe("An unexpected error occurred.");
    expect(sanitizeError(null)).toBe("An unexpected error occurred.");
  });
});
