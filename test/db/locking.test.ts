import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject, listProjects } from "../../src/projects/repository.js";

interface LockHolder {
  exited: Promise<unknown>;
}

// Holds the write lock on `path` for `ms` milliseconds in a separate process,
// the way a concurrent CLI invocation would. Resolves once the lock is held.
function holdWriteLock(path: string, ms: number): Promise<LockHolder> {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path)});
    db.exec("BEGIN IMMEDIATE");
    db.exec("INSERT INTO projects (name) VALUES ('holder')");
    process.stdout.write("locked\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
    db.exec("COMMIT");
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  return new Promise((resolve, reject) => {
    child.stdout!.once("data", () => resolve({ exited }));
    child.once("error", reject);
  });
}

describe("database locking", () => {
  let dir: string;
  let db: DB | undefined;
  let holder: LockHolder | undefined;

  afterEach(async () => {
    await holder?.exited;
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("waits for another process's write lock instead of failing", async () => {
    dir = mkdtempSync(join(tmpdir(), "rw-lock-"));
    const path = join(dir, "lock.db");
    db = await DB.open(path);
    await migrate(db);

    holder = await holdWriteLock(path, 300);
    await createProject(db, "waiter");
    await holder.exited;

    const names = (await listProjects(db)).map((p) => p.name).sort();
    expect(names).toEqual(["holder", "waiter"]);
  });

  it("does not deadlock a read-then-write transaction against another writer", async () => {
    dir = mkdtempSync(join(tmpdir(), "rw-lock-"));
    const path = join(dir, "lock.db");
    db = await DB.open(path);
    await migrate(db);

    holder = await holdWriteLock(path, 300);
    await db.transaction(async () => {
      await listProjects(db!);
      await createProject(db!, "in-tx");
    });
    await holder.exited;

    const names = (await listProjects(db)).map((p) => p.name).sort();
    expect(names).toEqual(["holder", "in-tx"]);
  });
});
