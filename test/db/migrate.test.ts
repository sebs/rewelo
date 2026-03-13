import { describe, it, expect, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";

describe("migrate", () => {
  let db: DB;

  afterEach(async () => {
    if (db) await db.close();
  });

  it("creates the rw schema on first run", async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const rows = await db.all(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'rw' ORDER BY table_name"
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
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'rw' AND table_name = 'projects'"
    );
    expect(rows).toHaveLength(1);
  });
});
