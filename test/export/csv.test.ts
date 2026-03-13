import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { exportCsv } from "../../src/export/csv.js";

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
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("title");
  });

  it("exports tickets with tags", async () => {
    const ticket = await createTicket(db, { projectId, title: "Login", benefit: 8, penalty: 3, estimate: 5, risk: 2 });
    const tag = await createTag(db, projectId, "state", "backlog");
    await assignTag(db, ticket.id, tag.id);

    const csv = await exportCsv(db, projectId);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Login");
    expect(lines[1]).toContain("state:backlog");
  });

  it("includes calculation columns with --with-calculations", async () => {
    await createTicket(db, { projectId, title: "Calc", benefit: 8, penalty: 3, estimate: 5, risk: 2 });

    const csv = await exportCsv(db, projectId, { withCalculations: true });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("value");
    expect(lines[0]).toContain("cost");
    expect(lines[0]).toContain("priority");
    // value = 8+3=11, cost = 5+2=7, priority = 11/7 ≈ 1.57
    expect(lines[1]).toContain("11");
    expect(lines[1]).toContain("7");
    expect(lines[1]).toContain("1.57");
  });

  it("escapes CSV fields with commas", async () => {
    await createTicket(db, { projectId, title: "Login, Signup" });
    const csv = await exportCsv(db, projectId);
    expect(csv).toContain('"Login, Signup"');
  });
});
