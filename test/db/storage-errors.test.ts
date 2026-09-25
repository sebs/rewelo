import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
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
  });
});
