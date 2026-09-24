import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeError } from "../../src/validation/errors.js";
import { AppError, ValidationError } from "../../src/validation/strings.js";

describe("sanitizeError", () => {
  it("passes through ValidationError messages", () => {
    const err = new ValidationError("Project name must not be empty");
    assert.equal(sanitizeError(err), "Project name must not be empty");
  });

  it("passes through AppError messages", () => {
    assert.equal(sanitizeError(new AppError("Ticket not found")), "Ticket not found");
    assert.equal(sanitizeError(new AppError("Tag not found")), "Tag not found");
    assert.ok((sanitizeError(new AppError("benefit must be a Fibonacci number"))).includes("Fibonacci"));
    assert.ok((sanitizeError(new AppError("denominator is zero"))).includes("denominator is zero"));
  });

  it("hides database errors from user", () => {
    const dbErr = new Error("no such table: projects");
    assert.equal(sanitizeError(dbErr), "An internal error occurred. Please try again.");
  });

  it("hides SQL details from user", () => {
    const sqlErr = new Error("Parser Error: syntax error at or near 'SELECT'");
    assert.equal(sanitizeError(sqlErr), "An internal error occurred. Please try again.");
  });

  it("handles non-Error objects", () => {
    assert.equal(sanitizeError("string error"), "An unexpected error occurred.");
    assert.equal(sanitizeError(42), "An unexpected error occurred.");
    assert.equal(sanitizeError(null), "An unexpected error occurred.");
  });

  it("explains foreign key failures instead of hiding them as internal errors", () => {
    assert.match(sanitizeError(new Error("FOREIGN KEY constraint failed")), /no longer exists/);
  });
});
