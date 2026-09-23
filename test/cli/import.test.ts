import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw import (CLI)", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    db = join(dir, "x.db");
    expect(runCli(["--db", db, "project", "create", "P"]).code).toBe(0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const importCsv = (file: string) => runCli(["--db", db, "import", "csv", file, "--project", "P"]);

  it("imports a regular .csv file", () => {
    writeFileSync(join(dir, "ok.csv"), "title\nA\n");
    const r = importCsv(join(dir, "ok.csv"));
    expect(r.stdout).toContain("Imported 1 tickets");
  });

  it("rejects a file with the wrong extension", () => {
    writeFileSync(join(dir, "t.txt"), "title\nA\n");
    const r = importCsv(join(dir, "t.txt"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Import file must have one of these extensions: .csv");
  });

  it("rejects a JSON file for CSV import", () => {
    writeFileSync(join(dir, "t.json"), "{}");
    expect(importCsv(join(dir, "t.json")).stderr).toContain("extensions: .csv");
  });

  it("rejects a directory", () => {
    mkdirSync(join(dir, "d.csv"));
    const r = importCsv(join(dir, "d.csv"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("must be a regular file");
  });

  it("rejects a missing file with a clear message", () => {
    const r = importCsv(join(dir, "nope.csv"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("does not exist");
  });

  it("rejects a symlink to a non-CSV file", () => {
    symlinkSync("/etc/hosts", join(dir, "h.csv"));
    const r = importCsv(join(dir, "h.csv"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("extensions: .csv");
  });

  it("validates the JSON import path too", () => {
    writeFileSync(join(dir, "t.csv"), "title\nA\n");
    const r = runCli(["--db", db, "import", "json", join(dir, "t.csv"), "--project", "P"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("extensions: .json");
  });
});
