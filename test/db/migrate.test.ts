import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { AppError } from "../../src/validation/strings.js";

describe("migrate", () => {
  let db: DB;

  afterEach(async () => {
    if (db) await db.close();
  });

  it("creates the schema on first run", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const rows = await db.all(
      "SELECT name AS table_name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const tables = rows.map((r) => r.table_name);
    assert.ok(tables.includes("projects"));
    assert.ok(tables.includes("tickets"));
    assert.ok(tables.includes("tags"));
    assert.ok(tables.includes("ticket_tags"));
    assert.ok(tables.includes("ticket_tag_changes"));
    assert.ok(tables.includes("ticket_revisions"));
    assert.ok(tables.includes("tag_revisions"));
  });

  it("is idempotent on second run", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    await migrate(db);
    const rows = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'"
    );
    assert.equal(rows.length, 1);
  });

  async function tables(): Promise<string[]> {
    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    return rows.map((r) => r.name);
  }

  it("marks new databases as rewelo databases", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const [row] = await db.all<{ application_id: number }>("PRAGMA application_id");
    assert.equal(row.application_id, 0x52574c4f); // "RWLO"
  });

  it("refuses a foreign database without touching it", async () => {
    db = await DB.open(":memory:");
    await db.exec("CREATE TABLE tickets (x); INSERT INTO tickets VALUES (1);");

    await assert.rejects(migrate(db), AppError);
    await assert.rejects(migrate(db), /not a rewelo database/);
    assert.deepEqual(await tables(), ["tickets"]);
  });

  it("refuses a foreign database with a same-named projects table", async () => {
    db = await DB.open(":memory:");
    await db.exec("CREATE TABLE projects (pid, label)");

    await assert.rejects(migrate(db), /not a rewelo database/);
  });

  // The schema as first released with SQLite, before application_id and
  // user_version existed.
  async function simulateVersion1(markApplicationId: boolean): Promise<void> {
    await migrate(db);
    await db.exec(`DROP TABLE ticket_deletions; PRAGMA user_version = 0;`);
    if (!markApplicationId) await db.exec("PRAGMA application_id = 0");
  }

  it("accepts an unmarked database created by an earlier SQLite build", async () => {
    db = await DB.open(":memory:");
    await simulateVersion1(false);

    await migrate(db);
    const [row] = await db.all<{ application_id: number }>("PRAGMA application_id");
    assert.equal(row.application_id, 0x52574c4f);
    assert.ok((await tables()).includes("ticket_deletions"));
  });

  it("upgrades a marked version 1 database", async () => {
    db = await DB.open(":memory:");
    await simulateVersion1(true);

    await migrate(db);
    assert.ok((await tables()).includes("ticket_deletions"));
    const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
    assert.equal(row.user_version, 2);
  });

  it("creates new databases at the current schema version", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
    assert.equal(row.user_version, 2);
  });
});
