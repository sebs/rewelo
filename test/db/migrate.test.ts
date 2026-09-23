import { describe, it, expect, afterEach } from "vitest";
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
    expect(tables).toContain("projects");
    expect(tables).toContain("tickets");
    expect(tables).toContain("tags");
    expect(tables).toContain("ticket_tags");
    expect(tables).toContain("ticket_tag_changes");
    expect(tables).toContain("ticket_revisions");
    expect(tables).toContain("tag_revisions");
  });

  it("is idempotent on second run", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    await migrate(db);
    const rows = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'"
    );
    expect(rows).toHaveLength(1);
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
    expect(row.application_id).toBe(0x52574c4f); // "RWLO"
  });

  it("refuses a foreign database without touching it", async () => {
    db = await DB.open(":memory:");
    await db.exec("CREATE TABLE tickets (x); INSERT INTO tickets VALUES (1);");

    await expect(migrate(db)).rejects.toThrow(AppError);
    await expect(migrate(db)).rejects.toThrow("not a rewelo database");
    expect(await tables()).toEqual(["tickets"]);
  });

  it("refuses a foreign database with a same-named projects table", async () => {
    db = await DB.open(":memory:");
    await db.exec("CREATE TABLE projects (pid, label)");

    await expect(migrate(db)).rejects.toThrow("not a rewelo database");
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
    expect(row.application_id).toBe(0x52574c4f);
    expect(await tables()).toContain("ticket_deletions");
  });

  it("upgrades a marked version 1 database", async () => {
    db = await DB.open(":memory:");
    await simulateVersion1(true);

    await migrate(db);
    expect(await tables()).toContain("ticket_deletions");
    const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(row.user_version).toBe(2);
  });

  it("creates new databases at the current schema version", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
    expect(row.user_version).toBe(2);
  });
});
