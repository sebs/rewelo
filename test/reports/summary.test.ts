import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { getProjectSummary } from "../../src/reports/summary.js";
import { groupByTagPrefix } from "../../src/reports/group.js";

describe("project summary report", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Reports");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns zeroes for empty project", async () => {
    const summary = await getProjectSummary(db, projectId);
    assert.equal(summary.totalTickets, 0);
    assert.deepEqual(summary.byState, {});
    assert.equal(summary.topByPriority.length, 0);
  });

  it("counts tickets by state tag", async () => {
    const t1 = await createTicket(db, { projectId, title: "A" });
    const t2 = await createTicket(db, { projectId, title: "B" });
    const t3 = await createTicket(db, { projectId, title: "C" });
    const backlog = await createTag(db, projectId, "state", "backlog");
    const wip = await createTag(db, projectId, "state", "wip");

    await assignTag(db, t1.id, backlog.id);
    await assignTag(db, t2.id, backlog.id);
    await assignTag(db, t3.id, wip.id);

    const summary = await getProjectSummary(db, projectId);
    assert.equal(summary.totalTickets, 3);
    assert.equal(summary.byState.backlog, 2);
    assert.equal(summary.byState.wip, 1);
  });

  it("counts a tag value that is also an Object property name (constructor)", async () => {
    const a = await createTicket(db, { projectId, title: "A", benefit: 8 });
    const b = await createTicket(db, { projectId, title: "B" });
    await assignTag(db, a.id, (await createTag(db, projectId, "state", "constructor")).id);
    await assignTag(db, a.id, (await createTag(db, projectId, "kind", "constructor")).id);
    await assignTag(db, b.id, (await createTag(db, projectId, "kind", "bug")).id);

    assert.deepEqual((await getProjectSummary(db, projectId)).byState, { constructor: 1 });
    assert.deepEqual((await groupByTagPrefix(db, projectId, "kind")).map((g) => [g.value, g.ticketCount]), [["constructor", 1], ["bug", 1]]);
    assert.deepEqual((await groupByTagPrefix(db, projectId, "state")).map((g) => g.value), ["constructor"]);
  });

  it("returns top-N tickets sorted by priority", async () => {
    await createTicket(db, { projectId, title: "Low", benefit: 1, penalty: 1, estimate: 13, risk: 8 });
    await createTicket(db, { projectId, title: "High", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    await createTicket(db, { projectId, title: "Med", benefit: 5, penalty: 3, estimate: 3, risk: 2 });

    const summary = await getProjectSummary(db, projectId, 2);
    assert.equal(summary.topByPriority.length, 2);
    assert.equal(summary.topByPriority[0].title, "High");
  });

  it("counts tickets without a state tag apart from a real state:untagged tag", async () => {
    await createTicket(db, { projectId, title: "No tags" });
    const tagged = await createTicket(db, { projectId, title: "Tagged untagged" });
    await assignTag(db, tagged.id, (await createTag(db, projectId, "state", "untagged")).id);

    const summary = await getProjectSummary(db, projectId);
    assert.deepEqual(summary.byState, { untagged: 1 });
    assert.equal(summary.withoutState, 1);
  });

  it("ranks open tickets only in the top list", async () => {
    const done = await createTicket(db, { projectId, title: "Done already", benefit: 21 });
    await createTicket(db, { projectId, title: "Still open", benefit: 3 });
    await assignTag(db, done.id, (await createTag(db, projectId, "state", "done")).id);
    assert.deepEqual((await getProjectSummary(db, projectId)).topByPriority.map((t) => t.title), ["Still open"]);
  });
});
