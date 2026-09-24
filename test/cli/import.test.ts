import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw import (CLI)", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    db = join(dir, "x.db");
    assert.equal(runCli(["--db", db, "project", "create", "P"]).code, 0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const importCsv = (file: string) => runCli(["--db", db, "import", "csv", file, "--project", "P"]);

  it("imports a regular .csv file", () => {
    writeFileSync(join(dir, "ok.csv"), "title\nA\n");
    const r = importCsv(join(dir, "ok.csv"));
    assert.ok(r.stdout.includes("Imported 1 ticket\n"));
  });

  it("refuses a file over 50 MB before reading it", () => {
    const huge = join(dir, "huge.csv");
    writeFileSync(huge, "");
    truncateSync(huge, 3 * 1024 * 1024 * 1024); // sparse: 3 GB without using disk
    const r = importCsv(huge);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /huge\.csv is 3072\.0 MB; imports take at most 50 MB/);
  });

  it("rejects a file with the wrong extension", () => {
    writeFileSync(join(dir, "t.txt"), "title\nA\n");
    const r = importCsv(join(dir, "t.txt"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("Import file must have one of these extensions: .csv"));
  });

  it("rejects a JSON file for CSV import", () => {
    writeFileSync(join(dir, "t.json"), "{}");
    assert.ok((importCsv(join(dir, "t.json")).stderr).includes("extensions: .csv"));
  });

  it("rejects a directory", () => {
    mkdirSync(join(dir, "d.csv"));
    const r = importCsv(join(dir, "d.csv"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("must be a regular file"));
  });

  it("rejects a missing file with a clear message", () => {
    const r = importCsv(join(dir, "nope.csv"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("does not exist"));
  });

  it("rejects a symlink to a non-CSV file", () => {
    symlinkSync("/etc/hosts", join(dir, "h.csv"));
    const r = importCsv(join(dir, "h.csv"));
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("extensions: .csv"));
  });

  it("validates the JSON import path too", () => {
    writeFileSync(join(dir, "t.csv"), "title\nA\n");
    const r = runCli(["--db", db, "import", "json", join(dir, "t.csv"), "--project", "P"]);
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes("extensions: .json"));
  });
});

describe("rw import json into a new project (CLI)", () => {
  it("creates the project and restores tickets and tags", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    try {
      runCli(["--db", db, "project", "create", "P"]);
      runCli(["--db", db, "ticket", "create", "--project", "P", "--title", "A", "--benefit", "5"]);
      runCli(["--db", db, "tag", "assign", "state:wip", "--project", "P", "--ticket", "A"]);
      runCli(["--db", db, "export", "json", "--project", "P", "--output", join(dir, "p.json")]);

      const r = runCli(["--db", db, "import", "json", join(dir, "p.json"), "--project", "NewProject"]);
      assert.ok(r.stdout.includes('Created project "NewProject"'));
      assert.ok(r.stdout.includes("Imported 1 ticket\n"));

      const list = runCli(["--db", db, "--json", "ticket", "list", "--project", "NewProject", "--tag", "state:wip"]);
      assert.deepEqual(JSON.parse(list.stdout).items.map((t: { title: string }) => t.title), ["A"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
