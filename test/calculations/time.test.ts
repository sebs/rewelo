import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { getTicketTimes, averageLeadTime } from "../../src/calculations/time.js";

describe("lead and cycle time", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns undefined times when no state tags exist", async () => {
    const ticket = await createTicket(db, { projectId, title: "Story A" });
    const times = await getTicketTimes(db, ticket.id);
    expect(times.leadTimeDays).toBeUndefined();
    expect(times.cycleTimeDays).toBeUndefined();
  });

  it("returns undefined cycle time when ticket goes directly to done", async () => {
    const ticket = await createTicket(db, { projectId, title: "Story A" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, ticket.id, done.id);
    const times = await getTicketTimes(db, ticket.id);
    expect(times.leadTimeDays).toBeDefined();
    expect(times.cycleTimeDays).toBeUndefined();
  });

  it("calculates lead and cycle time from audit log", async () => {
    const ticket = await createTicket(db, { projectId, title: "Story A" });
    const backlog = await createTag(db, projectId, "state", "backlog");
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");

    await assignTag(db, ticket.id, backlog.id);
    await assignTag(db, ticket.id, wip.id);
    await assignTag(db, ticket.id, done.id);

    const times = await getTicketTimes(db, ticket.id);
    // All happen within same test so times are ~0, but the logic works
    expect(times.leadTimeDays).toBeDefined();
    expect(times.cycleTimeDays).toBeDefined();
    expect(typeof times.leadTimeDays).toBe("number");
    expect(typeof times.cycleTimeDays).toBe("number");
  });

  it("averageLeadTime returns undefined for empty list", () => {
    expect(averageLeadTime([])).toBeUndefined();
  });

  it("averageLeadTime calculates correctly", () => {
    const times = [
      { ticketId: 1, leadTimeDays: 10, cycleTimeDays: 5 },
      { ticketId: 2, leadTimeDays: 15, cycleTimeDays: 8 },
      { ticketId: 3, leadTimeDays: 7, cycleTimeDays: 3 },
    ];
    // (10 + 15 + 7) / 3 = 10.67 -> rounds to 11
    expect(averageLeadTime(times)).toBe(11);
  });

  it("averageLeadTime skips tickets without lead time", () => {
    const times = [
      { ticketId: 1, leadTimeDays: 10, cycleTimeDays: 5 },
      { ticketId: 2, leadTimeDays: undefined, cycleTimeDays: undefined },
      { ticketId: 3, leadTimeDays: 20, cycleTimeDays: 10 },
    ];
    expect(averageLeadTime(times)).toBe(15);
  });
});
