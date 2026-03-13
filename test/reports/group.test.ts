import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { groupByTagPrefix } from "../../src/reports/group.js";

describe("group by tag prefix report", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "GroupTest");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty for no matching tags", async () => {
    await createTicket(db, { projectId, title: "A" });
    const groups = await groupByTagPrefix(db, projectId, "feature");
    expect(groups).toHaveLength(0);
  });

  it("groups tickets by tag value", async () => {
    const t1 = await createTicket(db, { projectId, title: "A", benefit: 8, penalty: 3, estimate: 5, risk: 2 });
    const t2 = await createTicket(db, { projectId, title: "B", benefit: 5, penalty: 2, estimate: 3, risk: 1 });
    const auth = await createTag(db, projectId, "feature", "auth");
    const ui = await createTag(db, projectId, "feature", "ui");

    await assignTag(db, t1.id, auth.id);
    await assignTag(db, t2.id, ui.id);

    const groups = await groupByTagPrefix(db, projectId, "feature");
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.value === "auth")!.ticketCount).toBe(1);
    expect(groups.find((g) => g.value === "ui")!.ticketCount).toBe(1);
  });

  it("calculates average priority per group", async () => {
    const t1 = await createTicket(db, { projectId, title: "A", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    const t2 = await createTicket(db, { projectId, title: "B", benefit: 1, penalty: 1, estimate: 13, risk: 8 });
    const auth = await createTag(db, projectId, "feature", "auth");

    await assignTag(db, t1.id, auth.id);
    await assignTag(db, t2.id, auth.id);

    const groups = await groupByTagPrefix(db, projectId, "feature");
    expect(groups[0].ticketCount).toBe(2);
    expect(groups[0].averagePriority).toBeGreaterThan(0);
  });
});
