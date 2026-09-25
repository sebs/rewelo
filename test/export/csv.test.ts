import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { exportCsv } from "../../src/transfer/csv/export.js";

describe("CSV export", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Export");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("exports empty project as headers only", async () => {
    const csv = await exportCsv(db, projectId);
    const lines = csv.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("title"));
  });

  it("exports tickets with tags", async () => {
    const ticket = await createTicket(db, { projectId, title: "Login", benefit: 8, penalty: 3, estimate: 5, risk: 2 });
    const tag = await createTag(db, projectId, "state", "backlog");
    await assignTag(db, ticket.id, tag.id);

    const csv = await exportCsv(db, projectId);
    const lines = csv.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes("Login"));
    assert.ok(lines[1].includes("state:backlog"));
  });

  it("includes calculation columns with --with-calculations", async () => {
    await createTicket(db, { projectId, title: "Calc", benefit: 8, penalty: 3, estimate: 5, risk: 2 });

    const csv = await exportCsv(db, projectId, { withCalculations: true });
    const lines = csv.trim().split("\n");
    assert.ok(lines[0].includes("value"));
    assert.ok(lines[0].includes("cost"));
    assert.ok(lines[0].includes("priority"));
    // value = 8+3=11, cost = 5+2=7, priority = 11/7 ≈ 1.57
    assert.ok(lines[1].includes("11"));
    assert.ok(lines[1].includes("7"));
    assert.ok(lines[1].includes("1.57"));
  });

  it("escapes CSV fields with commas", async () => {
    await createTicket(db, { projectId, title: "Login, Signup" });
    const csv = await exportCsv(db, projectId);
    assert.ok(csv.includes('"Login, Signup"'));
  });
});
