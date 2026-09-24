import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(groups.length, 0);
  });

  it("groups tickets by tag value", async () => {
    const t1 = await createTicket(db, { projectId, title: "A", benefit: 8, penalty: 3, estimate: 5, risk: 2 });
    const t2 = await createTicket(db, { projectId, title: "B", benefit: 5, penalty: 2, estimate: 3, risk: 1 });
    const auth = await createTag(db, projectId, "feature", "auth");
    const ui = await createTag(db, projectId, "feature", "ui");

    await assignTag(db, t1.id, auth.id);
    await assignTag(db, t2.id, ui.id);

    const groups = await groupByTagPrefix(db, projectId, "feature");
    assert.equal(groups.length, 2);
    assert.equal(groups.find((g) => g.value === "auth")!.ticketCount, 1);
    assert.equal(groups.find((g) => g.value === "ui")!.ticketCount, 1);
  });

  it("calculates average priority per group", async () => {
    const t1 = await createTicket(db, { projectId, title: "A", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    const t2 = await createTicket(db, { projectId, title: "B", benefit: 1, penalty: 1, estimate: 13, risk: 8 });
    const auth = await createTag(db, projectId, "feature", "auth");

    await assignTag(db, t1.id, auth.id);
    await assignTag(db, t2.id, auth.id);

    const groups = await groupByTagPrefix(db, projectId, "feature");
    assert.equal(groups[0].ticketCount, 2);
    assert.ok(groups[0].averagePriority > 0);
  });

  it("rounds the average half up", async () => {
    const tag = await createTag(db, projectId, "team", "x");
    // priorities 2/5 = 0.4 and 3/4 = 0.75, mean 0.575
    const a = await createTicket(db, { projectId, title: "Ga", benefit: 1, penalty: 1, estimate: 2, risk: 3 });
    const b = await createTicket(db, { projectId, title: "Gb", benefit: 1, penalty: 2, estimate: 1, risk: 3 });
    await assignTag(db, a.id, tag.id);
    await assignTag(db, b.id, tag.id);
    assert.equal((await groupByTagPrefix(db, projectId, "team"))[0].averagePriority, 0.58);
  });
});
