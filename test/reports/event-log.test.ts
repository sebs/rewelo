import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket, deleteTicket } from "../../src/tickets/repository.js";
import { createTag, renameTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { createRevision } from "../../src/revisions/repository.js";
import { getEventLog } from "../../src/reports/event-log.js";

describe("event log", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "EvLog");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty log for empty project", async () => {
    const events = await getEventLog(db, projectId);
    assert.equal(events.length, 0);
  });

  it("includes ticket_created events", async () => {
    await createTicket(db, { projectId, title: "A", benefit: 5 });
    const events = await getEventLog(db, projectId);
    assert.equal(events.some((e) => e.type === "ticket_created" && e.ticketTitle === "A"), true);
  });

  it("includes ticket_updated events after revision + update", async () => {
    const t = await createTicket(db, { projectId, title: "B", benefit: 3 });
    await createRevision(db, t);
    await updateTicket(db, projectId, t.id, { benefit: 8 });

    const events = await getEventLog(db, projectId);
    assert.equal(events.some((e) => e.type === "ticket_updated"), true);
  });

  it("includes tag_added and tag_removed events", async () => {
    const t = await createTicket(db, { projectId, title: "C" });
    const tag = await createTag(db, projectId, "state", "wip");
    await assignTag(db, t.id, tag.id);
    await removeTag(db, t.id, tag.id);

    const events = await getEventLog(db, projectId);
    assert.equal(events.some((e) => e.type === "tag_added"), true);
    assert.equal(events.some((e) => e.type === "tag_removed"), true);
  });

  it("respects since filter", async () => {
    await createTicket(db, { projectId, title: "Old" });
    const futureDate = "2099-01-01T00:00:00Z";
    const events = await getEventLog(db, projectId, futureDate);
    assert.equal(events.length, 0);
  });

  it("respects limit", async () => {
    await createTicket(db, { projectId, title: "X1" });
    await createTicket(db, { projectId, title: "X2" });
    await createTicket(db, { projectId, title: "X3" });

    const events = await getEventLog(db, projectId, undefined, 2);
    assert.equal(events.length, 2);
  });

  it("returns events in reverse chronological order", async () => {
    await createTicket(db, { projectId, title: "First" });
    await createTicket(db, { projectId, title: "Second" });

    const events = await getEventLog(db, projectId);
    const created = events.filter((e) => e.type === "ticket_created");
    assert.equal(created[0].ticketTitle, "Second");
    assert.equal(created[1].ticketTitle, "First");
  });

  it("shows the scores a ticket was created with, not its current ones", async () => {
    const t = await createTicket(db, { projectId, title: "S", benefit: 8, risk: 3 });
    await updateTicket(db, projectId, t.id, { benefit: 13 });
    await updateTicket(db, projectId, t.id, { risk: 5 });

    const created = (await getEventLog(db, projectId)).find((e) => e.type === "ticket_created");
    assert.deepEqual(created!.detail, { benefit: 8, penalty: 1, estimate: 1, risk: 3 });
  });

  it("returns no events for limit 0", async () => {
    await createTicket(db, { projectId, title: "Z" });
    assert.deepEqual(await getEventLog(db, projectId, undefined, 0), []);
  });

  it("keeps the tag name a change was made under when the tag is renamed later", async () => {
    const t = await createTicket(db, { projectId, title: "R" });
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, t.id, done.id);
    await renameTag(db, projectId, done.id, "state", "closed");

    const added = (await getEventLog(db, projectId)).find((e) => e.type === "tag_added");
    assert.deepEqual(added!.detail, { prefix: "state", value: "done" });
  });

  it("shows the previous description in ticket_updated events", async () => {
    const t = await createTicket(db, { projectId, title: "Desc", description: "old" });
    await updateTicket(db, projectId, t.id, { description: "new" });

    const updated = (await getEventLog(db, projectId)).find((e) => e.type === "ticket_updated");
    assert.equal(updated!.detail.prev_description, "old");
  });

  it("orders events written in the same millisecond by when they were written", async () => {
    const t = await createTicket(db, { projectId, title: "Tie" });
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, t.id, wip.id);
    await assignTag(db, t.id, done.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-01-01T00:00:00.000Z'");
    await db.run("UPDATE tickets SET created_at = '2026-01-01T00:00:00.000Z'");

    const events = (await getEventLog(db, projectId)).map((e) => `${e.type} ${(e.detail as any).value ?? ""}`.trim());
    assert.deepEqual(events, ["tag_added done", "tag_removed wip", "tag_added wip", "ticket_created"]);
  });

  it("reports deleted tickets", async () => {
    const t = await createTicket(db, { projectId, title: "Gone" });
    await deleteTicket(db, projectId, t.id);

    const [latest] = await getEventLog(db, projectId);
    assert.equal(latest.type, "ticket_deleted");
    assert.equal(latest.ticketTitle, "Gone");
  });

  it("orders same-millisecond events from different tables by when they were written", async () => {
    const t = await createTicket(db, { projectId, title: "Mixed" });
    const tag = await createTag(db, projectId, "x", "v");
    // Let tag change ids run ahead of revision ids
    for (let i = 0; i < 5; i++) {
      await assignTag(db, t.id, tag.id);
      await removeTag(db, t.id, tag.id);
    }
    await assignTag(db, t.id, tag.id);
    await updateTicket(db, projectId, t.id, { description: "later" });
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-01-01T00:00:00.000Z'");
    await db.run("UPDATE ticket_revisions SET revised_at = '2026-01-01T00:00:00.000Z'");
    await db.run("UPDATE tickets SET created_at = '2025-12-31T00:00:00.000Z'");

    const [newest, before] = await getEventLog(db, projectId, undefined, 2);
    assert.equal(newest.type, "ticket_updated");
    assert.equal(before.type, "tag_added");
  });
});
