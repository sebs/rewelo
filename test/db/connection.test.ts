import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";

describe("DB connection", () => {
  let db: DB;

  afterEach(async () => {
    if (db) await db.close();
  });

  it("opens an in-memory database", async () => {
    db = await DB.open(":memory:");
    const rows = await db.all("SELECT 1 AS n");
    // node:sqlite rows have a null prototype; compare their data
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ n: 1 }]);
  });

  it("executes DDL statements", async () => {
    db = await DB.open(":memory:");
    await db.exec("CREATE TABLE test (id INTEGER)");
    await db.run("INSERT INTO test VALUES (?)", 42);
    const rows = await db.all("SELECT id FROM test");
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ id: 42 }]);
  });
});
