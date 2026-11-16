import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import type { Fibonacci } from "../../src/domain/scores.js";
import { getEstimateAccuracy, spearman, verdict } from "../../src/reports/estimates.js";

describe("spearman", () => {
  it("is 1 for the same order, -1 for the reverse, and handles ties", () => {
    assert.equal(spearman([1, 2, 3, 5], [2, 4, 9, 30]), 1);
    assert.equal(spearman([1, 2, 3], [9, 5, 1]), -1);
    assert.ok(Math.abs(spearman([1, 1, 2, 2], [1, 2, 3, 4])! - 0.894) < 0.001);
    assert.equal(spearman([3, 3, 3], [1, 2, 3]), null);
  });
});

describe("verdict", () => {
  it("names what the correlation means, and when there is too little to tell", () => {
    assert.match(verdict(4, null), /Too few done tickets with a cycle time \(4\)/);
    assert.match(verdict(10, 0.8), /predict cycle time well/);
    assert.match(verdict(10, 0.4), /somewhat/);
    assert.match(verdict(10, 0.1), /don't predict/);
    assert.match(verdict(10, -0.5), /Larger estimates finished faster/);
  });
});

describe("getEstimateAccuracy", () => {
  let db: DB;
  let projectId: number;
  let wip: number;
  let done: number;

  // Done after `days` of work, from 2026-03-01
  const finished = async (title: string, estimate: Fibonacci, days: number) => {
    const t = await createTicket(db, { projectId, title, estimate });
    await assignTag(db, t.id, wip);
    await assignTag(db, t.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-01T00:00:00.000Z' WHERE ticket_id = ? AND value = 'wip'", t.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ? AND value = 'done'", new Date(Date.parse("2026-03-01T00:00:00Z") + days * 86_400_000).toISOString(), t.id);
    return t;
  };

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Est")).id;
    wip = (await createTag(db, projectId, "state", "wip")).id;
    done = (await createTag(db, projectId, "state", "done")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("gives cycle time per estimate and how well estimates rank it", async () => {
    await finished("S1", 1, 1);
    await finished("S2", 1, 2);
    await finished("M1", 3, 4);
    await finished("M2", 3, 6);
    await finished("L1", 8, 10);
    const report = await getEstimateAccuracy(db, projectId);
    assert.equal(report.tickets, 5);
    assert.deepEqual(report.byEstimate, [
      { estimate: 1, count: 2, p50: 1, p85: 2 },
      { estimate: 3, count: 2, p50: 4, p85: 6 },
      { estimate: 8, count: 1, p50: 10, p85: 10 },
    ]);
    assert.equal(report.correlation, 0.95);
    assert.match(report.verdict, /predict cycle time well/);
  });

  it("takes the estimate a ticket had when work started, not a later re-estimate", async () => {
    const t = await finished("Grew", 1, 9);
    // Re-estimated after it was done: a revision keeps the 1
    await updateTicket(db, projectId, t.id, { estimate: 13 });
    await db.run("UPDATE ticket_revisions SET revised_at = '2026-03-20T00:00:00.000Z' WHERE ticket_id = ?", t.id);
    const report = await getEstimateAccuracy(db, projectId);
    assert.deepEqual(report.byEstimate.map((e) => e.estimate), [1]);
    assert.equal(report.reEstimated, 1);
  });

  it("counts a re-estimate before work started as the estimate", async () => {
    const t = await createTicket(db, { projectId, title: "Refined", estimate: 1 });
    await updateTicket(db, projectId, t.id, { estimate: 5 });
    await db.run("UPDATE ticket_revisions SET revised_at = '2026-02-01T00:00:00.000Z' WHERE ticket_id = ?", t.id);
    await assignTag(db, t.id, wip);
    await assignTag(db, t.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-01T00:00:00.000Z' WHERE ticket_id = ? AND value = 'wip'", t.id);
    const report = await getEstimateAccuracy(db, projectId);
    assert.deepEqual(report.byEstimate.map((e) => e.estimate), [5]);
    assert.equal(report.reEstimated, 0);
  });

  it("leaves out done tickets without a cycle time, and says so", async () => {
    const direct = await createTicket(db, { projectId, title: "Direct" });
    await assignTag(db, direct.id, done);
    const report = await getEstimateAccuracy(db, projectId);
    assert.equal(report.tickets, 0);
    assert.equal(report.withoutCycleTime, 1);
    assert.equal(report.correlation, null);
    assert.deepEqual(report.byEstimate, []);
  });
});
