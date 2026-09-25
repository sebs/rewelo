import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject, listProjects } from "../../src/projects/repository.js";
import { AppError } from "../../src/errors.js";

async function openAndMigrate(path: string): Promise<DB> {
  const db = await DB.open(path);
  await migrate(db);
  return db;
}

describe("storage errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-storage-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("explains a file that is not a SQLite database", async () => {
    writeFileSync(join(dir, "garbage.db"), "garbage");
    const attempt = openAndMigrate(join(dir, "garbage.db"));
    await assert.rejects(attempt, AppError);
    await assert.rejects(openAndMigrate(join(dir, "garbage.db")), /corrupted or is not a SQLite database/);
  });

  it("explains a path that cannot be opened", async () => {
    mkdirSync(join(dir, "folder.db"));
    await assert.rejects(openAndMigrate(join(dir, "folder.db")), /Cannot open the database file/);
    await assert.rejects(openAndMigrate(join(dir, "missing", "x.db")), /Cannot open the database file/);
  });

  it("explains a read-only database", async () => {
    const path = join(dir, "ro.db");
    (await openAndMigrate(path)).close();
    chmodSync(path, 0o444);
    const db = await DB.open(path);
    try {
      await assert.rejects(createProject(db, "P"), /The database file is read-only/);
    } finally {
      await db.close();
      chmodSync(path, 0o644);
    }
    // Reading it left no -wal or -shm behind
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("ro.db")), ["ro.db"]);
  });

  it("reads a database in a read-only directory, and says why it can't write", { skip: process.getuid?.() === 0 }, async () => {
    const ro = join(dir, "ro-dir");
    mkdirSync(ro);
    const path = join(ro, "x.db");
    const setup = await openAndMigrate(path);
    await createProject(setup, "A");
    await setup.close();
    chmodSync(ro, 0o555);
    try {
      const db = await openAndMigrate(path);
      try {
        assert.deepEqual((await listProjects(db)).map((p) => p.name), ["A"]);
        await assert.rejects(createProject(db, "B"), /The database's directory .*ro-dir is read-only: rewelo can read the database but not change it/);
      } finally {
        await db.close();
      }
    } finally {
      chmodSync(ro, 0o755);
    }
  });
});
