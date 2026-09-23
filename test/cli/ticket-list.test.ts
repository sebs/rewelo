import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw ticket list (CLI)", () => {
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

  it("quotes CSV fields and guards formulas in --csv output", () => {
    rw("ticket", "create", "--project", "P", "--title", 'say "hi", ok', "--benefit", "8");
    rw("ticket", "create", "--project", "P", "--title", '=HYPERLINK("http://evil","x")');

    const lines = rw("--csv", "ticket", "list", "--project", "P").stdout.trim().split("\n");
    expect(lines[0]).toBe("title,benefit,penalty,estimate,risk,value,cost,priority");
    expect(lines).toContain('"say ""hi"", ok",8,1,1,1,9,2,4.50');
    expect(lines).toContain(`"'=HYPERLINK(""http://evil"",""x"")",1,1,1,1,2,2,1.00`);
  });

  it("tag assign rejects two values of one prefix and reports replacements", () => {
    rw("ticket", "create", "--project", "P", "--title", "L");

    const both = rw("tag", "assign", "feature:auth", "feature:login", "--project", "P", "--ticket", "L");
    expect(both.code).toBe(1);
    expect(both.stderr).toContain('share the prefix "feature"');
    expect(rw("tag", "log", "--project", "P", "--ticket", "L").stdout).not.toContain("feature");

    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "L");
    const replace = rw("tag", "assign", "state:done", "--project", "P", "--ticket", "L");
    expect(replace.stdout).toContain('Assigned "state:done" to "L" (replaced "state:wip")');
  });
});
