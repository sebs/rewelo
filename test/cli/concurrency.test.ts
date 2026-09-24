import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BIN, runCli } from "./run.js";

// Runs the same CLI command in `n` processes at once
function inParallel(n: number, args: (i: number) => string[]): Promise<number[]> {
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      new Promise<number>((resolve) => {
        const child = spawn(process.execPath, [BIN, ...args(i)], { stdio: "ignore" });
        child.once("exit", (code) => resolve(code ?? -1));
      })
    )
  );
}

describe("concurrent CLI writes", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-conc-"));
    db = join(dir, "c.db");
    runCli(["--db", db, "project", "create", "C"]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a title only once when several processes race for it", async () => {
    const codes = await inParallel(12, () => ["--db", db, "ticket", "create", "--project", "C", "--title", "Same"]);
    assert.equal(codes.filter((c) => c === 0).length, 1);
    const list = JSON.parse(runCli(["--db", db, "--json", "ticket", "list", "--project", "C"]).stdout);
    assert.equal(list.total, 1);
  });
});
