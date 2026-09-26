import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sanitizeError, AppError, ValidationError } from "../src/errors.js";

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

  it("says the current directory is gone, not that a file is missing", () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, uv_cwd"), { code: "ENOENT", syscall: "uv_cwd" });
    assert.equal(sanitizeError(err), "The current directory no longer exists (it was deleted or moved): change to an existing directory");
  });

  it("says so for rw run in a deleted directory", { skip: process.platform === "win32" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-gone-"));
    const bin = resolve(__dirname, "../src/index.js");
    const r = spawnSync("sh", ["-c", `cd "${dir}" && rmdir "${dir}" && exec "${process.execPath}" "${bin}" --db /nonexistent/x.db ticket list`], { encoding: "utf-8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /The current directory no longer exists/);
  });
});
