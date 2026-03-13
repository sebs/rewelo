import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { getProjectSummary } from "../../src/reports/summary.js";

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
    expect(summary.totalTickets).toBe(0);
    expect(summary.byState).toEqual({});
    expect(summary.topByPriority).toHaveLength(0);
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
    expect(summary.totalTickets).toBe(3);
    expect(summary.byState.backlog).toBe(2);
    expect(summary.byState.wip).toBe(1);
  });

  it("returns top-N tickets sorted by priority", async () => {
    await createTicket(db, { projectId, title: "Low", benefit: 1, penalty: 1, estimate: 13, risk: 8 });
    await createTicket(db, { projectId, title: "High", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    await createTicket(db, { projectId, title: "Med", benefit: 5, penalty: 3, estimate: 3, risk: 2 });

    const summary = await getProjectSummary(db, projectId, 2);
    expect(summary.topByPriority).toHaveLength(2);
    expect(summary.topByPriority[0].title).toBe("High");
  });

  it("counts untagged tickets as 'untagged'", async () => {
    await createTicket(db, { projectId, title: "No tags" });
    const summary = await getProjectSummary(db, projectId);
    expect(summary.byState.untagged).toBe(1);
  });
});
