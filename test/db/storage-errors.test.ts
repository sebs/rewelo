import { describe, it, expect, afterAll } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { AppError } from "../../src/validation/strings.js";

async function openAndMigrate(path: string): Promise<DB> {
  const db = await DB.open(path);
  await migrate(db);
  return db;
}

describe("storage errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-storage-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("explains a file that is not a SQLite database", async () => {
    writeFileSync(join(dir, "garbage.db"), "garbage");
    const attempt = openAndMigrate(join(dir, "garbage.db"));
    await expect(attempt).rejects.toThrow(AppError);
    await expect(openAndMigrate(join(dir, "garbage.db"))).rejects.toThrow("corrupted or is not a SQLite database");
  });

  it("explains a path that cannot be opened", async () => {
    mkdirSync(join(dir, "folder.db"));
    await expect(openAndMigrate(join(dir, "folder.db"))).rejects.toThrow("Cannot open the database file");
    await expect(openAndMigrate(join(dir, "missing", "x.db"))).rejects.toThrow("Cannot open the database file");
  });

  it("explains a read-only database", async () => {
    const path = join(dir, "ro.db");
    (await openAndMigrate(path)).close();
    chmodSync(path, 0o444);
    const db = await DB.open(path);
    try {
      await expect(createProject(db, "P")).rejects.toThrow("The database file is read-only");
    } finally {
      await db.close();
      chmodSync(path, 0o644);
    }
  });
});
