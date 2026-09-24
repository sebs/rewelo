import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw report (CLI)", () => {
  let dir: string;
  let rw: (...args: string[]) => ReturnType<typeof runCli>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    rw = (...args) => runCli(["--db", db, ...args]);
    rw("project", "create", "P");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("summary heads the top list with the number of tickets shown", () => {
    rw("ticket", "create", "--project", "P", "--title", "A");
    rw("ticket", "create", "--project", "P", "--title", "B");
    const out = rw("report", "summary", "--project", "P").stdout;
    assert.ok(out.includes("Top 2 by priority:"), out);
  });
});
