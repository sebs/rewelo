import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { BIN, childEnv, runCli } from "./run.js";

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

  it("refuses an empty --output instead of writing to stdout", () => {
    for (const cmd of [["export", "csv"], ["export", "json"], ["report", "dashboard"]]) {
      const r = rw(...cmd, "--project", "P", "--output", "");
      assert.equal(r.code, 1, cmd.join(" "));
      assert.equal(r.stdout, "", cmd.join(" "));
      assert.match(r.stderr, /Export path must not be empty/, cmd.join(" "));
    }
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

  it("names the path and the problem when a file cannot be written or read", { skip: process.getuid?.() === 0 }, () => {
    const locked = join(dir, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    const out = join(locked, "x.json");
    const r = rw("export", "json", "--project", "P", "--output", out);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^Cannot write \S*locked\/x\.json: permission denied$/m);

    const unreadable = join(dir, "noread.json");
    writeFileSync(unreadable, "{}");
    chmodSync(unreadable, 0o000);
    // the path is shown resolved (on macOS /var is /private/var)
    assert.match(rw("import", "json", unreadable, "--project", "P").stderr, /^Cannot read \S*noread\.json: permission denied$/m);
    chmodSync(locked, 0o755);
  });

  it("stops quietly when the reader closes the pipe early", async () => {
    const csv = join(dir, "many.csv");
    writeFileSync(csv, "title,description\n" + Array.from({ length: 2000 }, (_, i) => `T${i},${"x".repeat(200)}`).join("\n"));
    rw("import", "csv", csv, "--project", "P");

    const child = spawn(process.execPath, [BIN, "--db", db, "export", "csv", "--project", "P"], { stdio: ["ignore", "pipe", "pipe"], env: childEnv() });
    let stderr = "";
    child.stderr!.on("data", (d) => (stderr += d));
    child.stdout!.once("data", () => child.stdout!.destroy());
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(stderr, "");
    assert.equal(code, 0);
  });
});
