import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag, renameTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
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
    assert.equal(times.leadTimeDays, undefined);
    assert.equal(times.cycleTimeDays, undefined);
  });

  it("returns undefined cycle time when ticket goes directly to done", async () => {
    const ticket = await createTicket(db, { projectId, title: "Story A" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, ticket.id, done.id);
    const times = await getTicketTimes(db, ticket.id);
    assert.notEqual(times.leadTimeDays, undefined);
    assert.equal(times.cycleTimeDays, undefined);
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
    assert.notEqual(times.leadTimeDays, undefined);
    assert.notEqual(times.cycleTimeDays, undefined);
    assert.equal(typeof times.leadTimeDays, "number");
    assert.equal(typeof times.cycleTimeDays, "number");
  });

  it("averageLeadTime returns undefined for empty list", () => {
    assert.equal(averageLeadTime([]), undefined);
  });

  it("averageLeadTime calculates correctly", () => {
    const times = [
      { ticketId: 1, ticketTitle: "T1", leadTimeDays: 10, cycleTimeDays: 5 },
      { ticketId: 2, ticketTitle: "T2", leadTimeDays: 15, cycleTimeDays: 8 },
      { ticketId: 3, ticketTitle: "T3", leadTimeDays: 7, cycleTimeDays: 3 },
    ];
    // (10 + 15 + 7) / 3 = 10.67 -> rounds to 11
    assert.equal(averageLeadTime(times), 11);
  });

  it("averageLeadTime skips tickets without lead time", () => {
    const times = [
      { ticketId: 1, ticketTitle: "T1", leadTimeDays: 10, cycleTimeDays: 5 },
      { ticketId: 2, ticketTitle: "T2", leadTimeDays: undefined, cycleTimeDays: undefined },
      { ticketId: 3, ticketTitle: "T3", leadTimeDays: 20, cycleTimeDays: 10 },
    ];
    assert.equal(averageLeadTime(times), 15);
  });

  it("does not count a reopened ticket as done", async () => {
    const ticket = await createTicket(db, { projectId, title: "Reopened" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, ticket.id, done.id);
    await removeTag(db, ticket.id, done.id);

    const times = await getTicketTimes(db, ticket.id);
    assert.equal(times.leadTimeDays, undefined);
    assert.equal(times.cycleTimeDays, undefined);
  });

  it("measures to the latest completion when a ticket was done twice", async () => {
    const ticket = await createTicket(db, { projectId, title: "Twice" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, ticket.id, done.id);
    await removeTag(db, ticket.id, done.id);
    await assignTag(db, ticket.id, done.id);

    await db.run(`UPDATE tickets SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, ticket.id);
    const changes = await db.all<{ id: number }>(
      `SELECT id FROM ticket_tag_changes WHERE ticket_id = ? ORDER BY id`, ticket.id
    );
    const at = ["2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z", "2026-01-11T00:00:00.000Z"];
    for (let i = 0; i < 3; i++) {
      await db.run(`UPDATE ticket_tag_changes SET changed_at = ? WHERE id = ?`, at[i], changes[i].id);
    }

    assert.equal((await getTicketTimes(db, ticket.id)).leadTimeDays, 10);
  });

  it("averages the exact lead times, not the rounded ones", async () => {
    const done = await createTag(db, projectId, "state", "done");
    const times = [];
    // lead times of 12h (0.5 d) and 9h36m (0.4 d): mean 0.45 d
    for (const [title, doneAt] of [["Half", "2026-01-01T12:00:00.000Z"], ["Less", "2026-01-01T09:36:00.000Z"]]) {
      const t = await createTicket(db, { projectId, title });
      await assignTag(db, t.id, done.id);
      await db.run(`UPDATE tickets SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?`, t.id);
      await db.run(`UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ?`, doneAt, t.id);
      times.push(await getTicketTimes(db, t.id));
    }
    assert.deepEqual(times.map((t) => t.leadTimeDays), [1, 0]);
    assert.equal(averageLeadTime(times), 0);
  });

  it("keeps cycle times when state:wip is renamed later", async () => {
    const t = await createTicket(db, { projectId, title: "Renamed wip" });
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, t.id, wip.id);
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "done")).id);
    await renameTag(db, projectId, wip.id, "state", "doing");

    assert.equal((await getTicketTimes(db, t.id)).cycleTimeDays, 0);
  });

  it("treats a renamed state tag as the same state for every ticket", async () => {
    const x = await createTicket(db, { projectId, title: "Before rename" });
    const y = await createTicket(db, { projectId, title: "After rename" });
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, x.id, wip.id);
    await renameTag(db, projectId, wip.id, "state", "doing");
    await assignTag(db, y.id, wip.id);
    const done = await createTag(db, projectId, "state", "done");
    for (const t of [x, y]) await assignTag(db, t.id, done.id);
    await renameTag(db, projectId, done.id, "state", "closed");

    for (const t of [x, y]) {
      const times = await getTicketTimes(db, t.id);
      assert.deepEqual([times.leadTimeDays, times.cycleTimeDays], [0, 0], t.title);
    }
  });
});
