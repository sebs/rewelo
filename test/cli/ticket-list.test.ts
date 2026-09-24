import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(lines[0], "title,benefit,penalty,estimate,risk,value,cost,priority");
    assert.ok(lines.includes('"say ""hi"", ok",8,1,1,1,9,2,4.50'));
    assert.ok(lines.includes(`"'=HYPERLINK(""http://evil"",""x"")",1,1,1,1,2,2,1.00`));
  });

  it("tag assign rejects two values of one prefix and reports replacements", () => {
    rw("ticket", "create", "--project", "P", "--title", "L");

    const both = rw("tag", "assign", "feature:auth", "feature:login", "--project", "P", "--ticket", "L");
    assert.equal(both.code, 1);
    assert.ok(both.stderr.includes('share the prefix "feature"'));
    assert.ok(!rw("tag", "log", "--project", "P", "--ticket", "L").stdout.includes("feature"));

    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "L");
    const replace = rw("tag", "assign", "state:done", "--project", "P", "--ticket", "L");
    assert.ok(replace.stdout.includes('Assigned "state:done" to "L" (replaced "state:wip")'));
  });

  it("finds tickets and projects by the same trimmed name they were created with", () => {
    rw("ticket", "create", "--project", "P", "--title", "  pad  ");
    const update = rw("ticket", "update", "--project", " P ", "--title", " pad ", "--benefit", "3");
    assert.equal(update.code, 0, update.stderr);
    assert.ok(update.stdout.includes('Updated "pad"'));
  });

  it("project diff lists description changes and deleted tickets", () => {
    rw("ticket", "create", "--project", "P", "--title", "A", "--description", "old");
    rw("ticket", "create", "--project", "P", "--title", "B");
    const since = new Date().toISOString();
    rw("ticket", "update", "--project", "P", "--title", "A", "--description", "new");
    rw("ticket", "delete", "--project", "P", "--title", "B");

    const out = rw("project", "diff", "--project", "P", "--since", since).stdout;
    assert.ok(out.includes("description: old → new"));
    assert.ok(out.includes("Deleted tickets (1):\n  - B"));
  });

  it("refuses a malformed .rewelo.json instead of using a parent's", () => {
    const parent = join(dir, "cfg");
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    writeFileSync(join(parent, ".rewelo.json"), JSON.stringify({ project: "P" }));
    writeFileSync(join(child, ".rewelo.json"), '{"project":"Q",}');

    const r = runCli(["--db", join(dir, "x.db"), "ticket", "create", "--title", "fromchild"], { cwd: child });
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("Invalid JSON in"));
    assert.ok(!rw("ticket", "list", "--project", "P").stdout.includes("fromchild"));
  });

  it("ticket update rejects an empty --new-title", () => {
    rw("ticket", "create", "--project", "P", "--title", "A");
    const r = rw("ticket", "update", "--project", "P", "--title", "A", "--new-title", "");
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("Ticket title must not be empty"));
  });

  it("normalises tag filters like tag assign does", () => {
    rw("ticket", "create", "--project", "P", "--title", "Done one");
    rw("ticket", "create", "--project", "P", "--title", "Open one");
    rw("tag", "assign", "STATE:Done", "--project", "P", "--ticket", "Done one");
    const list = (...args: string[]) => rw("--quiet", "ticket", "list", "--project", "P", ...args).stdout.trim();

    assert.equal(list("--tag", "STATE:DONE"), "Done one");
    assert.equal(list("--tag", "state: done"), "Done one");
    assert.equal(list("--exclude-tag", "STATE:DONE"), "Open one");
    assert.ok(rw("calc", "weights", "--project", "P", "--tag", "State:Done").stdout.includes("Done one"));
    assert.ok(rw("report", "group", "--project", "P", "--prefix", "State").stdout.includes("done"));
    const bad = rw("ticket", "list", "--project", "P", "--exclude-tag", "bad tag:x");
    assert.equal(bad.code, 1);
    assert.ok(bad.stderr.includes("Tag prefix must contain only"));
  });
});
