import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BIN, childEnv, runCli } from "./run.js";

// The prompt only appears in a terminal: script(1) gives the command one.
// Its options differ between macOS (BSD) and Linux (util-linux), and on
// macOS it can't read from a socket (Node's pipes): cat hands it a pipe.
const hasScript = process.platform !== "win32" && spawnSync("sh", ["-c", "command -v script"]).status === 0;
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Runs rw in a terminal and answers the prompt once it appears
function inTerminal(args: string[], answer: string): Promise<{ code: number | null; output: string }> {
  const cmd = [process.execPath, BIN, ...args].map(quote).join(" ");
  const shell = process.platform === "darwin" ? `cat | script -q /dev/null ${cmd}` : `cat | script -qec ${quote(cmd)} /dev/null`;
  const child = spawn("sh", ["-c", shell], { env: childEnv() });
  let output = "";
  let answered = false;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (!answered && output.includes("(y/N)")) {
      answered = true;
      child.stdin.end(answer);
    }
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve({ code, output })));
}

describe("rw project delete (prompt)", { skip: !hasScript }, () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-prompt-"));
    db = join(dir, "x.db");
    assert.equal(runCli(["--db", db, "project", "create", "Sp"]).code, 0);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when the deletion is declined, so rw project delete X && ... stops", async () => {
    const r = await inTerminal(["--db", db, "project", "delete", "Sp"], "n\r");
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, /Aborted\./);
    assert.match(runCli(["--db", db, "--quiet", "project", "list"]).stdout, /^Sp$/m);
  });

  it("deletes when the deletion is confirmed", async () => {
    const r = await inTerminal(["--db", db, "project", "delete", "Sp"], "y\r");
    assert.equal(r.code, 0, r.output);
    assert.equal(runCli(["--db", db, "--quiet", "project", "list"]).stdout, "");
  });
});
