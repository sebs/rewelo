import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw ticket history and project history (CLI)", () => {
  let dir: string;
  const rw = (...args: string[]) => runCli(["--db", join(dir, "h.db"), ...args]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-history-"));
    rw("project", "create", "P");
    rw("ticket", "create", "--project", "P", "--title", "C");
    // Four revisions: the state before each update, benefit 1, 2, 3, 5
    for (const benefit of ["2", "3", "5", "8"]) rw("ticket", "update", "--project", "P", "--title", "C", "--benefit", benefit);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("numbers revisions by their place in the whole history, also on a later page", () => {
    const rows = rw("--csv", "ticket", "history", "--project", "P", "--title", "C", "--offset", "2", "--limit", "2").stdout.trim().split("\n").slice(1);
    assert.deepEqual(rows.map((r) => r.split(",").slice(0, 3).join(",")), ["3,C,3", "4,C,5"]);
  });

  it("doesn't claim there are no revisions for --limit 0 or a page past the end", () => {
    const text = (...args: string[]) => rw(...args).stdout.trim();
    assert.equal(text("ticket", "history", "--project", "P", "--title", "C", "--limit", "0"), "No revisions shown (--limit 0).");
    assert.equal(text("ticket", "history", "--project", "P", "--title", "C", "--offset", "10"), "No revisions after the first 10.");
    assert.equal(text("project", "history", "--project", "P", "--limit", "0"), "No revisions shown (--limit 0).");
    assert.equal(text("project", "history", "--project", "P", "--offset", "100"), "No revisions after the first 100.");
    rw("ticket", "create", "--project", "P", "--title", "New");
    assert.equal(text("ticket", "history", "--project", "P", "--title", "New"), "No revisions found.");
    // A page of nothing at all is nothing, not a page past the end
    assert.equal(text("ticket", "history", "--project", "P", "--title", "New", "--offset", "10"), "No revisions found.");
    assert.equal(text("ticket", "history", "--project", "P", "--title", "New", "--limit", "0"), "No revisions found.");
    assert.equal(text("project", "history", "--project", "P", "--since", "2099-01-01", "--offset", "5"), "No revisions found.");
  });
});
