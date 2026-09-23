import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw calc (CLI)", () => {
  let dir: string;
  let rw: (...args: string[]) => ReturnType<typeof runCli>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    rw = (...args) => runCli(["--db", db, ...args]);
    rw("project", "create", "P");
    rw("ticket", "create", "--project", "P", "--title", "A");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("calc priority validates inline weights like config weights --set", () => {
    const negative = rw("calc", "priority", "--project", "P", "--w1", "-5");
    expect(negative.code).toBe(1);
    expect(negative.stderr).toContain("Weight w1 must be a non-negative number");

    const huge = rw("calc", "priority", "--project", "P", "--w1", "1e308", "--w2", "1e308");
    expect(huge.code).toBe(1);
    expect(huge.stderr).toContain("must not exceed 100");

    expect(rw("calc", "priority", "--project", "P", "--w1", "3").code).toBe(0);
  });

  it("rejects a --limit beyond the safe integer range", () => {
    const r = rw("report", "event-log", "--project", "P", "--limit", "99999999999999999999");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a valid integer");
  });
});
