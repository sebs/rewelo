import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("finds tickets and projects by the same trimmed name they were created with", () => {
    rw("ticket", "create", "--project", "P", "--title", "  pad  ");
    const update = rw("ticket", "update", "--project", " P ", "--title", " pad ", "--benefit", "3");
    expect(update.code, update.stderr).toBe(0);
    expect(update.stdout).toContain('Updated "pad"');
  });

  it("project diff lists description changes and deleted tickets", () => {
    rw("ticket", "create", "--project", "P", "--title", "A", "--description", "old");
    rw("ticket", "create", "--project", "P", "--title", "B");
    const since = new Date(Date.now() - 1000).toISOString();
    rw("ticket", "update", "--project", "P", "--title", "A", "--description", "new");
    rw("ticket", "delete", "--project", "P", "--title", "B");

    const out = rw("project", "diff", "--project", "P", "--since", since).stdout;
    expect(out).toContain("description: old → new");
    expect(out).toContain("Deleted tickets (1):\n  - B");
  });

  it("refuses a malformed .rewelo.json instead of using a parent's", () => {
    const parent = join(dir, "cfg");
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(parent, ".rewelo.json"), JSON.stringify({ project: "P" }));
    writeFileSync(join(child, ".rewelo.json"), '{"project":"Q",}');

    const r = runCli(["--db", join(dir, "x.db"), "ticket", "create", "--title", "fromchild"], { cwd: child });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Invalid JSON in");
    expect(rw("ticket", "list", "--project", "P").stdout).not.toContain("fromchild");
  });

  it("ticket update rejects an empty --new-title", () => {
    rw("ticket", "create", "--project", "P", "--title", "A");
    const r = rw("ticket", "update", "--project", "P", "--title", "A", "--new-title", "");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Ticket title must not be empty");
  });
});
