import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

describe("rw export (CLI)", () => {
  let dir: string;
  let db: string;

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
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("symbolic link");
    expect(readFileSync(join(dir, "precious.txt"), "utf-8")).toBe("keep");
  });
});
