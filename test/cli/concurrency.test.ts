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

  it("keeps one value per prefix when several processes assign at once", async () => {
    runCli(["--db", db, "ticket", "create", "--project", "C", "--title", "T"]);
    await inParallel(8, (i) => ["--db", db, "tag", "assign", `state:v${i}`, "--project", "C", "--ticket", "T"]);
    const held = Array.from({ length: 8 }, (_, i) =>
      runCli(["--db", db, "--quiet", "ticket", "list", "--project", "C", "--tag", `state:v${i}`]).stdout.trim()
    ).filter(Boolean);
    assert.deepEqual(held, ["T"]);
  });

  it("tells every process that loses a project create race that the project exists", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        new Promise<string>((resolve) => {
          const child = spawn(process.execPath, [BIN, "--db", db, "project", "create", "Same"], { stdio: ["ignore", "ignore", "pipe"] });
          let stderr = "";
          child.stderr!.on("data", (d) => (stderr += d));
          child.once("exit", () => resolve(stderr.trim()));
        })
      )
    );
    const errors = results.filter(Boolean);
    assert.equal(errors.length, 7);
    for (const e of errors) assert.equal(e, 'A project named "Same" already exists');
  });

  it("records a ticket deleted by several processes at once only once", async () => {
    runCli(["--db", db, "ticket", "create", "--project", "C", "--title", "Gone"]);
    const codes = await inParallel(6, () => ["--db", db, "ticket", "delete", "--project", "C", "--title", "Gone"]);
    assert.equal(codes.filter((c) => c === 0).length, 1);
    const events = JSON.parse(runCli(["--db", db, "--json", "report", "event-log", "--project", "C"]).stdout);
    assert.equal(events.filter((e: { type: string }) => e.type === "ticket_deleted").length, 1);
  });

  it("renames only one of two tags racing for the same new name, leaving no stray revision", async () => {
    for (const tag of ["x:a", "x:b"]) runCli(["--db", db, "tag", "create", tag, "--project", "C"]);
    await inParallel(2, (i) => ["--db", db, "tag", "rename", "--project", "C", "--prefix", "x", "--old", i === 0 ? "a" : "b", "--new", "n"]);
    const tags = runCli(["--db", db, "--quiet", "tag", "list", "--project", "C"]).stdout.trim().split("\n").sort();
    assert.equal(tags.length, 2);
    assert.ok(tags.includes("x:n"));
    const { DB } = await import("../../src/db/connection.js");
    const conn = await DB.open(db);
    const revisions = await conn.all("SELECT 1 FROM tag_revisions");
    await conn.close();
    assert.equal(revisions.length, 1);
  });

  it("stores only one direction of a relation created both ways at once", async () => {
    for (const t of ["A", "B"]) runCli(["--db", db, "ticket", "create", "--project", "C", "--title", t]);
    await inParallel(6, (i) => ["--db", db, "relation", "create", "--project", "C", "--source", i % 2 ? "A" : "B", "--type", "blocks", "--target", i % 2 ? "B" : "A"]);
    const relations = JSON.parse(runCli(["--db", db, "--json", "relation", "list-all", "--project", "C"]).stdout);
    assert.equal(relations.length, 1);
  });

  it("sets weights from several processes at once without errors", async () => {
    const codes = await inParallel(6, (i) => ["--db", db, "config", "weights", "--project", "C", "--set", "--w1", String(i + 1)]);
    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0]);
  });
});
