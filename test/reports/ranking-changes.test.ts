import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, deleteTicket, updateTicket } from "../../src/tickets/repository.js";
import { createRelation } from "../../src/relations/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import type { Fibonacci } from "../../src/domain/scores.js";
import { getRankingChanges, rankMove } from "../../src/reports/ranking-changes.js";
import { renderDashboard } from "../../src/reports/dashboard.js";

const SINCE = "2026-03-01T00:00:00.000Z";
const BEFORE = "2026-02-01T00:00:00.000Z";
const AFTER = "2026-03-05T00:00:00.000Z";

describe("ranking changes", () => {
  let db: DB;
  let projectId: number;
  let done: number;

  // A ticket that existed before SINCE
  const old = async (title: string, benefit: Fibonacci) => {
    const t = await createTicket(db, { projectId, title, benefit });
    await db.run("UPDATE tickets SET created_at = ? WHERE id = ?", BEFORE, t.id);
    return t;
  };
  const changes = async () => getRankingChanges(db, projectId, SINCE, new Date("2026-03-10T00:00:00Z"));
  const byTitle = async (title: string) => (await changes()).changes.find((c) => c.title === title);

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Rank")).id;
    done = (await createTag(db, projectId, "state", "done")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("explains a re-score with the scores from and to, from the revisions", async () => {
    await old("A", 21);
    await old("B", 8);
    const c = await old("C", 3);
    await updateTicket(db, projectId, c.id, { benefit: 21, penalty: 21 });
    await db.run("UPDATE ticket_revisions SET revised_at = ? WHERE ticket_id = ?", AFTER, c.id);

    const report = await changes();
    assert.deepEqual(report.changes, [
      { ticketId: c.id, title: "C", rankThen: 3, rankNow: 1, priorityThen: 2, priorityNow: 21, reasons: ["re-scored: benefit 3 → 21, penalty 1 → 21"] },
    ]);
    // A and B moved down one each, only because C did
    assert.equal(report.shifted, 2);
    assert.equal(rankMove(report.changes[0]), "#3 → #1");
  });

  it("names new, done and reopened tickets", async () => {
    await old("Stays", 2);
    const finished = await old("Finished", 5);
    const reopened = await old("Reopened", 3);
    await assignTag(db, reopened.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ?", BEFORE, reopened.id);
    await removeTag(db, reopened.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ? AND action = 'removed'", AFTER, reopened.id);
    await assignTag(db, finished.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ?", AFTER, finished.id);
    await createTicket(db, { projectId, title: "Fresh", benefit: 21 });

    const report = await changes();
    assert.deepEqual(report.changes.map((c) => [c.title, rankMove(c), c.reasons]), [
      ["Fresh", "new at #1", ["new"]],
      ["Reopened", "reopened at #2", ["reopened"]],
      ["Finished", "#1 → done", ["done"]],
    ]);
    assert.equal(report.openThen, 2);
    assert.equal(report.openNow, 3);
  });

  it("names a new blocker, and a blocker that got done", async () => {
    const waiting = await old("Waiting", 5);
    const blocker = await old("Blocker", 2);
    const freed = await old("Freed", 3);
    const gone = await old("Gone blocker", 1);
    await createRelation(db, projectId, blocker.id, waiting.id, "blocks");
    await db.run("UPDATE ticket_relations SET created_at = ? WHERE target_id = ?", AFTER, waiting.id);
    await createRelation(db, projectId, gone.id, freed.id, "blocks");
    await db.run("UPDATE ticket_relations SET created_at = ? WHERE target_id = ?", BEFORE, freed.id);
    await assignTag(db, gone.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ?", AFTER, gone.id);

    assert.deepEqual((await byTitle("Waiting"))?.reasons, ["now blocked by Blocker"]);
    assert.deepEqual((await byTitle("Freed"))?.reasons, ["no longer blocked: Gone blocker is done"]);
  });

  it("lists tickets deleted since by title, and leaves alone what didn't change", async () => {
    await old("Same", 3);
    const gone = await old("Deleted", 5);
    await deleteTicket(db, projectId, gone.id);
    await db.run("UPDATE ticket_deletions SET deleted_at = ?, created_at = ?", AFTER, BEFORE);
    const report = await changes();
    assert.deepEqual(report.changes, []);
    assert.deepEqual(report.deleted, ["Deleted"]);
  });

  it("goes back 7 days by default, and refuses a timestamp it can't read", async () => {
    const report = await getRankingChanges(db, projectId, undefined, new Date("2026-03-10T00:00:00Z"));
    assert.equal(report.since, "2026-03-03T00:00:00.000Z");
    await assert.rejects(getRankingChanges(db, projectId, "last tuesday"), /Invalid timestamp/);
  });

  it("shows the changes of the last 7 days on the dashboard", async () => {
    await old("Old", 2);
    await createTicket(db, { projectId, title: "Brand new", benefit: 13 });
    const html = await renderDashboard(db, projectId, "Rank");
    assert.match(html, /<h2 id="changes">Ranking changes in the last 7 days<\/h2>/);
    assert.match(html, /<tr><td>Brand new<\/td><td class="move">new at #1<\/td><td>new<\/td><\/tr>/);
    assert.match(html, /1 other ticket moved only because these did\./);
  });

  it("shows at most 20 changes on the dashboard", async () => {
    for (let i = 0; i < 25; i++) await createTicket(db, { projectId, title: `New ${i}` });
    const html = await renderDashboard(db, projectId, "Rank");
    assert.equal(html.match(/<td class="move">/g)?.length, 20);
    assert.match(html, /Showing 20 of 25 changes; <code>rw report changes<\/code>/);
  });
});
