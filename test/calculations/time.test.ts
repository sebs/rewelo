import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag, deleteTag, getTag, renameTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { getProjectTimes, averageLeadTime } from "../../src/calculations/time.js";

describe("lead and cycle time", () => {
  let db: DB;
  let projectId: number;

  // A ticket's times, as the project's times report computes them
  const timesOf = async (ticketId: number) =>
    (await getProjectTimes(db, projectId)).find((t) => t.ticketId === ticketId)!;

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
    const times = await timesOf(ticket.id);
    assert.equal(times.leadTimeDays, undefined);
    assert.equal(times.cycleTimeDays, undefined);
  });

  it("returns undefined cycle time when ticket goes directly to done", async () => {
    const ticket = await createTicket(db, { projectId, title: "Story A" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, ticket.id, done.id);
    const times = await timesOf(ticket.id);
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

    const times = await timesOf(ticket.id);
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

    const times = await timesOf(ticket.id);
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

    assert.equal((await timesOf(ticket.id)).leadTimeDays, 10);
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
      times.push(await timesOf(t.id));
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

    assert.equal((await timesOf(t.id)).cycleTimeDays, 0);
  });

  it("recognises states by name: renaming a state tag changes its meaning", async () => {
    // done -> cancelled: no longer done; a new state:done is
    const a = await createTicket(db, { projectId, title: "Cancelled" });
    const b = await createTicket(db, { projectId, title: "Finished" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, a.id, done.id);
    await renameTag(db, projectId, done.id, "state", "cancelled");
    await assignTag(db, b.id, (await createTag(db, projectId, "state", "done")).id);
    assert.equal((await timesOf(a.id)).leadTimeDays, undefined);
    assert.equal((await timesOf(b.id)).leadTimeDays, 0);

    // wip -> backlog: tagging it afterwards doesn't start work
    const y = await createTicket(db, { projectId, title: "Backlog first" });
    const old = await createTag(db, projectId, "state", "wip");
    await renameTag(db, projectId, old.id, "state", "backlog");
    await assignTag(db, y.id, old.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-09-10T00:00:00.000Z' WHERE ticket_id = ?", y.id);
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, y.id, wip.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-09-20T00:00:00.000Z' WHERE ticket_id = ? AND value = 'wip'", y.id);
    await assignTag(db, y.id, (await getTag(db, projectId, "state", "done"))!.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-09-24T00:00:00.000Z' WHERE ticket_id = ? AND value = 'done'", y.id);
    assert.equal((await timesOf(y.id)).cycleTimeDays, 4);
  });

  it("keeps cycle times when the renamed wip tag is deleted", async () => {
    const t = await createTicket(db, { projectId, title: "Doing" });
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, t.id, wip.id);
    await renameTag(db, projectId, wip.id, "state", "doing");
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "done")).id);
    await deleteTag(db, projectId, wip.id);
    assert.equal((await timesOf(t.id)).cycleTimeDays, 0);
  });

  it("computes the same times for a whole project at once", async () => {
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");
    const tickets = [];
    for (const title of ["open", "working", "finished", "reopened"]) tickets.push(await createTicket(db, { projectId, title }));
    await assignTag(db, tickets[1].id, wip.id);
    await assignTag(db, tickets[2].id, wip.id);
    await assignTag(db, tickets[2].id, done.id);
    await assignTag(db, tickets[3].id, done.id);
    await removeTag(db, tickets[3].id, done.id);
    await db.run("UPDATE tickets SET created_at = '2026-01-01T00:00:00.000Z'");
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-01-05T00:00:00.000Z' WHERE value = 'wip'");
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-01-11T00:00:00.000Z' WHERE value = 'done'");

    const perTicket = [];
    for (const t of tickets) perTicket.push(await timesOf(t.id));
    const all = await getProjectTimes(db, projectId);
    assert.deepEqual(all, perTicket);
    assert.deepEqual(all.map((t) => [t.leadTimeDays, t.cycleTimeDays]), [[undefined, undefined], [undefined, undefined], [10, 6], [undefined, undefined]]);
  });
});
