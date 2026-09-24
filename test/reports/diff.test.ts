import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject, deleteProject } from "../../src/projects/repository.js";
import { createTicket, deleteTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { createRevision } from "../../src/revisions/repository.js";
import { getProjectDiff } from "../../src/reports/diff.js";

describe("project diff", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Diff");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty diff when nothing changed", async () => {
    const diff = await getProjectDiff(db, projectId, "2099-01-01T00:00:00Z");
    assert.equal(diff.newTickets.length, 0);
    assert.equal(diff.updatedTickets.length, 0);
    assert.equal(diff.tagChanges.length, 0);
  });

  it("detects new tickets since timestamp", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    await createTicket(db, { projectId, title: "Fresh", benefit: 8, penalty: 5, estimate: 2, risk: 1 });

    const diff = await getProjectDiff(db, projectId, before);
    assert.equal(diff.newTickets.length, 1);
    assert.equal(diff.newTickets[0].title, "Fresh");
    assert.ok(diff.newTickets[0].priority > 0);
  });

  it("detects score changes via revisions", async () => {
    const t = await createTicket(db, { projectId, title: "Scored", benefit: 3, penalty: 2, estimate: 1, risk: 1 });
    const before = new Date().toISOString();
    await createRevision(db, t);
    await updateTicket(db, projectId, t.id, { benefit: 13 });

    const diff = await getProjectDiff(db, projectId, before);
    assert.equal(diff.updatedTickets.length, 1);
    assert.equal(diff.updatedTickets[0].title, "Scored");
    const benefitChange = diff.updatedTickets[0].changes.find((c) => c.field === "benefit");
    assert.notEqual(benefitChange, undefined);
    assert.equal(benefitChange!.from, 3);
    assert.equal(benefitChange!.to, 13);
  });

  it("detects tag additions and removals as net changes", async () => {
    const t = await createTicket(db, { projectId, title: "Tagged" });
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");
    const team = await createTag(db, projectId, "team", "x");
    await assignTag(db, t.id, team.id);
    await new Promise((r) => setTimeout(r, 5));
    const before = new Date().toISOString();
    await assignTag(db, t.id, wip.id);
    await assignTag(db, t.id, done.id); // replaces wip
    await removeTag(db, t.id, team.id);

    const diff = await getProjectDiff(db, projectId, before);
    assert.deepEqual(diff.tagChanges, [{ ticketId: t.id, ticketTitle: "Tagged", added: ["state:done"], removed: ["team:x"] }]);
  });

  it("leaves out tags that were assigned and removed again", async () => {
    const t = await createTicket(db, { projectId, title: "Tagged" });
    const tag = await createTag(db, projectId, "state", "wip");
    const before = new Date().toISOString();
    await assignTag(db, t.id, tag.id);
    await removeTag(db, t.id, tag.id);

    assert.deepEqual((await getProjectDiff(db, projectId, before)).tagChanges, []);
  });

  it("ignores changes before the since timestamp", async () => {
    const t = await createTicket(db, { projectId, title: "Old", benefit: 3 });
    await createRevision(db, t);
    await updateTicket(db, projectId, t.id, { benefit: 8 });

    const diff = await getProjectDiff(db, projectId, "2099-01-01T00:00:00Z");
    assert.equal(diff.newTickets.length, 0);
    assert.equal(diff.updatedTickets.length, 0);
  });

  it("collapses multiple revisions into one diff per ticket", async () => {
    const t = await createTicket(db, { projectId, title: "Multi", benefit: 1, penalty: 1 });
    const before = new Date().toISOString();

    await createRevision(db, t);
    const t2 = await updateTicket(db, projectId, t.id, { benefit: 5 });
    await createRevision(db, t2);
    await updateTicket(db, projectId, t.id, { benefit: 13 });

    const diff = await getProjectDiff(db, projectId, before);
    assert.equal(diff.updatedTickets.length, 1);
    // Should diff from original (1) to current (13)
    const benefitChange = diff.updatedTickets[0].changes.find((c) => c.field === "benefit");
    assert.equal(benefitChange!.from, 1);
    assert.equal(benefitChange!.to, 13);
  });

  it("reports description changes", async () => {
    const t = await createTicket(db, { projectId, title: "D", description: "old" });
    const since = new Date(Date.now() - 1000).toISOString();
    await updateTicket(db, projectId, t.id, { description: "new" });

    const diff = await getProjectDiff(db, projectId, since);
    assert.deepEqual(diff.updatedTickets, [
      { ticketId: t.id, title: "D", changes: [{ field: "description", from: "old", to: "new" }] },
    ]);
  });

  it("reports tickets deleted since the timestamp", async () => {
    const kept = await createTicket(db, { projectId, title: "Kept" });
    const gone = await createTicket(db, { projectId, title: "Gone" });
    const since = new Date(Date.now() - 1000).toISOString();
    await deleteTicket(db, projectId, gone.id);

    const diff = await getProjectDiff(db, projectId, since);
    assert.deepEqual(diff.deletedTickets.map((r) => ({ ...r })), [{ id: gone.id, title: "Gone" }]);
    assert.ok(kept);

    const later = await getProjectDiff(db, projectId, "2099-01-01T00:00:00Z");
    assert.deepEqual(later.deletedTickets, []);
  });

  it("forgets deletion records when the project is deleted", async () => {
    const t = await createTicket(db, { projectId, title: "X" });
    await deleteTicket(db, projectId, t.id);
    assert.equal(await deleteProject(db, "Diff"), true);
    assert.deepEqual(await db.all("SELECT * FROM ticket_deletions"), []);
  });
});
