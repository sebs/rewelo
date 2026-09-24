import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate, SCHEMA_VERSION } from "../../src/db/migrate.js";
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

  // Versions before 4 have neither the event_order table nor its triggers
  async function dropEventOrder(): Promise<void> {
    const triggers = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'");
    for (const { name } of triggers) await db.exec(`DROP TRIGGER ${name}`);
    await db.exec("DROP TABLE event_order");
  }

  // The schema as first released with SQLite, before application_id and
  // user_version existed.
  async function simulateVersion1(markApplicationId: boolean): Promise<void> {
    await migrate(db);
    await dropEventOrder();
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
    assert.equal(row.user_version, SCHEMA_VERSION);
  });

  it("creates new databases at the current schema version", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
    assert.equal(row.user_version, SCHEMA_VERSION);
  });

  it("orders existing history rows when adding the event order", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    await db.exec(`
      INSERT INTO projects (id, name) VALUES (1, 'P');
      INSERT INTO tickets (id, project_id, title, created_at) VALUES (1, 1, 'A', '2026-01-02T00:00:00.000Z');
      INSERT INTO ticket_deletions (project_id, ticket_id, title, deleted_at) VALUES (1, 9, 'Gone', '2026-01-01T00:00:00.000Z');
      ALTER TABLE ticket_deletions DROP COLUMN created_at;
      PRAGMA user_version = 3;`);
    await dropEventOrder();

    await migrate(db);
    const rows = await db.all<{ source: string }>("SELECT source FROM event_order ORDER BY seq");
    assert.deepEqual(rows.map((r) => r.source), ["deletion", "ticket"]);
    await db.run("INSERT INTO tickets (project_id, title) VALUES (1, 'B')");
    assert.equal((await db.all("SELECT 1 FROM event_order")).length, 3);
  });

  it("adds the creation time to deletion records", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    await db.exec("ALTER TABLE ticket_deletions DROP COLUMN created_at; PRAGMA user_version = 4;");

    await migrate(db);
    const columns = await db.all<{ name: string }>("PRAGMA table_info(ticket_deletions)");
    assert.ok(columns.some((c) => c.name === "created_at"));
  });

  it("refuses a database from a newer schema version", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);

    await assert.rejects(migrate(db), /schema version \d+, but this rewelo supports up to version/);
  });

  it("backfills tag changes with the tag's name at the time of the change", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    // A version 2 table: tag changes without their own prefix/value
    await db.exec(`
      DROP TABLE ticket_tag_changes;
      CREATE TABLE ticket_tag_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, tag_id INTEGER NOT NULL,
        action TEXT NOT NULL, changed_at TEXT NOT NULL);
      INSERT INTO projects (id, name) VALUES (1, 'P');
      INSERT INTO tickets (id, project_id, title) VALUES (1, 1, 'A');
      INSERT INTO tags (id, project_id, prefix, value) VALUES (1, 1, 'state', 'closed');
      INSERT INTO tag_revisions (tag_id, prefix, value, revised_at) VALUES (1, 'state', 'done', '2026-01-02T00:00:00.000Z');
      INSERT INTO ticket_tag_changes (ticket_id, tag_id, action, changed_at) VALUES
        (1, 1, 'added', '2026-01-01T00:00:00.000Z'),
        (1, 1, 'removed', '2026-01-03T00:00:00.000Z');
      ALTER TABLE ticket_deletions DROP COLUMN created_at;
      PRAGMA user_version = 2;`);

    await migrate(db);
    const rows = await db.all<{ value: string }>("SELECT value FROM ticket_tag_changes ORDER BY id");
    assert.deepEqual(rows.map((r) => r.value), ["done", "closed"]);
  });
});
