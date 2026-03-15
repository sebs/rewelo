import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
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
    expect(health.totalTickets).toBe(0);
    expect(health.doneTickets).toBe(0);
    expect(health.openTickets).toBe(0);
    expect(health.totalBacklogCost).toBe(0);
  });

  it("separates done from open tickets", async () => {
    const t1 = await createTicket(db, { projectId, title: "Done", benefit: 5, penalty: 3, estimate: 3, risk: 2 });
    const t2 = await createTicket(db, { projectId, title: "Open", benefit: 8, penalty: 5, estimate: 5, risk: 3 });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, t1.id, done.id);

    const health = await getBacklogHealth(db, projectId);
    expect(health.totalTickets).toBe(2);
    expect(health.doneTickets).toBe(1);
    expect(health.openTickets).toBe(1);
    // Only open ticket contributes to backlog cost: 5 + 3 = 8
    expect(health.totalBacklogCost).toBe(8);
  });

  it("classifies high vs low priority", async () => {
    // High: (13+8)/(1+1) = 10.5 > 1.5
    await createTicket(db, { projectId, title: "High", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    // Low: (1+1)/(13+8) = 0.095 < 1.5
    await createTicket(db, { projectId, title: "Low", benefit: 1, penalty: 1, estimate: 13, risk: 8 });

    const health = await getBacklogHealth(db, projectId);
    expect(health.highPriorityCount).toBe(1);
    expect(health.lowPriorityCount).toBe(1);
    expect(health.highToLowRatio).toBe(1);
  });

  it("highToLowRatio is undefined when no low priority tickets", async () => {
    await createTicket(db, { projectId, title: "High", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    const health = await getBacklogHealth(db, projectId);
    expect(health.highToLowRatio).toBeNull();
  });
});
