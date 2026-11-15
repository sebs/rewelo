import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
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
    await createTicket(db, { projectId, title: "Open", benefit: 8, penalty: 5, estimate: 5, risk: 3 });
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

  it("refuses a threshold of 0 or less: every priority is over 0", async () => {
    for (const threshold of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(getBacklogHealth(db, projectId, threshold), /threshold must be a number greater than 0/);
    }
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

  describe("stale scores", () => {
    const DAY = 86_400_000;
    const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
    // A ticket created days ago, its revisions too: rewriting the clock
    // after the fact, as an import of an old backlog would have it
    async function old(title: string, days: number) {
      const t = await createTicket(db, { projectId, title, benefit: 5, penalty: 3, estimate: 3, risk: 2 });
      await db.run("UPDATE tickets SET created_at = ? WHERE id = ?", ago(days), t.id);
      return t;
    }
    const stale = async (staleDays?: number) =>
      (await getBacklogHealth(db, projectId, 1.5, staleDays)).staleTickets.map((t) => [t.title, t.days]);

    it("lists the open tickets not scored for staleDays (default 90), oldest first, with when they were scored", async () => {
      await old("Fresh", 10);
      await old("Older", 120);
      const oldest = await old("Oldest", 400);
      const health = await getBacklogHealth(db, projectId);
      assert.equal(health.staleDays, 90);
      assert.deepEqual(health.staleTickets.map((t) => [t.title, t.days]), [["Oldest", 400], ["Older", 120]]);
      const [{ created_at }] = await db.all<{ created_at: string }>("SELECT created_at FROM tickets WHERE id = ?", oldest.id);
      assert.equal(health.staleTickets[0].scoredAt, created_at);
      assert.deepEqual(await stale(200), [["Oldest", 400]]);
    });

    it("counts a change of scores as scoring, not a change of the title or the tags", async () => {
      const rescored = await old("Rescored", 300);
      await updateTicket(db, projectId, rescored.id, { estimate: 5 });
      const renamed = await old("Renamed", 300);
      await updateTicket(db, projectId, renamed.id, { title: "Renamed again", description: "More words" });
      const tagged = await old("Tagged", 300);
      await assignTag(db, tagged.id, (await createTag(db, projectId, "team", "x")).id);
      assert.deepEqual(await stale(), [["Renamed again", 300], ["Tagged", 300]]);
    });

    it("takes the last change of scores among older revisions", async () => {
      const t = await old("T", 300);
      await updateTicket(db, projectId, t.id, { benefit: 8 });
      await updateTicket(db, projectId, t.id, { title: "T2" });
      // The score change 150 days ago, the rename 5 days ago
      const [scored, renamed] = await db.all<{ id: number }>("SELECT id FROM ticket_revisions WHERE ticket_id = ? ORDER BY id", t.id);
      await db.run("UPDATE ticket_revisions SET revised_at = ? WHERE id = ?", ago(150), scored.id);
      await db.run("UPDATE ticket_revisions SET revised_at = ? WHERE id = ?", ago(5), renamed.id);
      assert.deepEqual(await stale(), [["T2", 150]]);
    });

    it("leaves out done tickets", async () => {
      const t = await old("Done long ago", 400);
      await assignTag(db, t.id, (await createTag(db, projectId, "state", "done")).id);
      assert.deepEqual(await stale(), []);
    });

    it("refuses staleDays that isn't a positive whole number", async () => {
      for (const days of [0, -3, 1.5, Number.NaN]) {
        await assert.rejects(getBacklogHealth(db, projectId, 1.5, days), /staleDays must be a whole number greater than 0/);
      }
    });
  });
});
