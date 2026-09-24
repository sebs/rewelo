import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag, renameTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { getBacklogHealth } from "../../src/reports/health.js";

describe("backlog health report", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "HealthTest");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns zeroes for empty project", async () => {
    const health = await getBacklogHealth(db, projectId);
    assert.equal(health.totalTickets, 0);
    assert.equal(health.doneTickets, 0);
    assert.equal(health.openTickets, 0);
    assert.equal(health.totalBacklogCost, 0);
  });

  it("separates done from open tickets", async () => {
    const t1 = await createTicket(db, { projectId, title: "Done", benefit: 5, penalty: 3, estimate: 3, risk: 2 });
    const t2 = await createTicket(db, { projectId, title: "Open", benefit: 8, penalty: 5, estimate: 5, risk: 3 });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, t1.id, done.id);

    const health = await getBacklogHealth(db, projectId);
    assert.equal(health.totalTickets, 2);
    assert.equal(health.doneTickets, 1);
    assert.equal(health.openTickets, 1);
    // Only open ticket contributes to backlog cost: 5 + 3 = 8
    assert.equal(health.totalBacklogCost, 8);
  });

  it("classifies high vs low priority", async () => {
    // High: (13+8)/(1+1) = 10.5 > 1.5
    await createTicket(db, { projectId, title: "High", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    // Low: (1+1)/(13+8) = 0.095 < 1.5
    await createTicket(db, { projectId, title: "Low", benefit: 1, penalty: 1, estimate: 13, risk: 8 });

    const health = await getBacklogHealth(db, projectId);
    assert.equal(health.highPriorityCount, 1);
    assert.equal(health.lowPriorityCount, 1);
    assert.equal(health.highToLowRatio, 1);
  });

  it("highToLowRatio is undefined when no low priority tickets", async () => {
    await createTicket(db, { projectId, title: "High", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    const health = await getBacklogHealth(db, projectId);
    assert.equal(health.highToLowRatio, null);
  });

  it("rounds the high:low ratio half up", async () => {
    for (let i = 0; i < 41; i++) await createTicket(db, { projectId, title: `h${i}`, benefit: 21, penalty: 21 });
    for (let i = 0; i < 40; i++) await createTicket(db, { projectId, title: `l${i}`, estimate: 21, risk: 21 });
    assert.equal((await getBacklogHealth(db, projectId)).highToLowRatio, 1.03); // 41/40 = 1.025
  });

  it("counts tickets as done by the tag's current name, like the summary", async () => {
    const t = await createTicket(db, { projectId, title: "Was done" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, t.id, done.id);
    await renameTag(db, projectId, done.id, "state", "wip");
    assert.equal((await getBacklogHealth(db, projectId)).doneTickets, 0);
  });
});
