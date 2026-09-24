import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw export (CLI)", () => {
  let dir: string;
  let db: string;
  const rw = (...args: string[]) => runCli(["--db", db, ...args]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    db = join(dir, "x.db");
    runCli(["--db", db, "project", "create", "P"]);
    runCli(["--db", db, "ticket", "create", "--project", "P", "--title", "A"]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to write through a symlink and leaves the target untouched", () => {
    writeFileSync(join(dir, "precious.txt"), "keep");
    symlinkSync(join(dir, "precious.txt"), join(dir, "out.csv"));

    const r = runCli(["--db", db, "export", "csv", "--project", "P", "--output", join(dir, "out.csv")]);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("symbolic link"));
    assert.equal(readFileSync(join(dir, "precious.txt"), "utf-8"), "keep");
  });

  it("only writes each format to its own file extension", () => {
    const out = (name: string) => join(dir, name);
    const dash = rw("report", "dashboard", "--project", "P", "--output", out("d.csv"));
    assert.equal(dash.code, 1);
    assert.ok(dash.stderr.includes("Export file must have one of these extensions: .html"));
    assert.ok((rw("export", "csv", "--project", "P", "--output", out("x.json")).stderr).includes("extensions: .csv"));
    assert.ok((rw("export", "json", "--project", "P", "--output", out("x.csv")).stderr).includes("extensions: .json"));
    assert.equal(rw("report", "dashboard", "--project", "P", "--output", out("d.html")).code, 0);
  });
});
