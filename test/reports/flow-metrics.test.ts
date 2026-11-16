import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { getFlowReport, percentiles, weekStart } from "../../src/reports/flow-metrics.js";

// Wednesday, in the week of Monday 2026-03-09
const NOW = new Date("2026-03-11T12:00:00.000Z");

describe("percentiles", () => {
  it("takes the nearest rank, so the value is one that occurred", () => {
    assert.deepEqual(percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), { count: 10, p50: 5, p85: 9, p95: 10 });
    assert.deepEqual(percentiles([4.26]), { count: 1, p50: 4.3, p85: 4.3, p95: 4.3 });
    assert.deepEqual(percentiles([]), { count: 0, p50: null, p85: null, p95: null });
  });
});

describe("weekStart", () => {
  it("is the Monday of the week, UTC", () => {
    const day = (iso: string) => new Date(weekStart(new Date(iso).getTime())).toISOString().slice(0, 10);
    assert.equal(day("2026-03-09T00:00:00Z"), "2026-03-09");
    assert.equal(day("2026-03-11T12:00:00Z"), "2026-03-09");
    assert.equal(day("2026-03-15T23:59:59Z"), "2026-03-09");
    assert.equal(day("2026-03-16T00:00:00Z"), "2026-03-16");
  });
});

describe("getFlowReport", () => {
  let db: DB;
  let projectId: number;
  let wip: number;
  let done: number;

  // A ticket created, started and done on the given days (UTC noon)
  const story = async (title: string, created: string, started?: string, finished?: string) => {
    const t = await createTicket(db, { projectId, title });
    await db.run("UPDATE tickets SET created_at = ? WHERE id = ?", `${created}T12:00:00.000Z`, t.id);
    if (started) {
      await assignTag(db, t.id, wip);
      await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ? AND value = 'wip'", `${started}T12:00:00.000Z`, t.id);
    }
    if (finished) {
      await assignTag(db, t.id, done);
      await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ? AND value = 'done'", `${finished}T12:00:00.000Z`, t.id);
    }
    return t;
  };

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Flow")).id;
    wip = (await createTag(db, projectId, "state", "wip")).id;
    done = (await createTag(db, projectId, "state", "done")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("counts the tickets done per week, the current week so far, and averages the complete ones", async () => {
    await story("A", "2026-02-20", "2026-02-23", "2026-02-24");
    await story("B", "2026-02-20", "2026-02-25", "2026-03-03");
    await story("C", "2026-02-20", "2026-03-02", "2026-03-04");
    await story("D", "2026-02-20", "2026-03-09", "2026-03-10");

    const flow = await getFlowReport(db, projectId, 2, NOW);
    assert.equal(flow.from, "2026-02-23");
    assert.deepEqual(flow.throughput, [
      { weekStart: "2026-02-23", done: 1, partial: false },
      { weekStart: "2026-03-02", done: 2, partial: false },
      { weekStart: "2026-03-09", done: 1, partial: true },
    ]);
    assert.equal(flow.averagePerWeek, 1.5);
  });

  it("gives cycle and lead time percentiles of the tickets done in the window", async () => {
    await story("Old", "2025-01-01", "2025-01-02", "2025-01-30"); // before the window
    await story("A", "2026-02-20", "2026-03-02", "2026-03-03"); // cycle 1, lead 11
    await story("B", "2026-02-20", "2026-03-02", "2026-03-05"); // cycle 3, lead 13
    await story("Direct", "2026-03-01", undefined, "2026-03-04"); // no cycle time, lead 3

    const flow = await getFlowReport(db, projectId, 2, NOW);
    assert.deepEqual(flow.cycleTimeDays, { count: 2, p50: 1, p85: 3, p95: 3 });
    assert.deepEqual(flow.leadTimeDays, { count: 3, p50: 11, p85: 13, p95: 13 });
  });

  it("lists the work in progress oldest first, flagging what is older than 85% took", async () => {
    await story("Quick", "2026-02-01", "2026-03-02", "2026-03-04"); // cycle 2
    await story("Fresh", "2026-03-01", "2026-03-10");
    await story("Stuck", "2026-02-01", "2026-02-20");
    await story("Waiting", "2026-03-01");

    const flow = await getFlowReport(db, projectId, 4, NOW);
    assert.deepEqual(
      flow.inProgress.map((t) => [t.title, t.ageDays, t.olderThanP85]),
      [["Stuck", 19, true], ["Fresh", 1, false]]
    );
  });

  it("covers every week since the first ticket with 0 weeks", async () => {
    await story("A", "2026-01-07", "2026-01-08", "2026-01-09");
    const flow = await getFlowReport(db, projectId, 0, NOW);
    assert.equal(flow.from, "2026-01-05");
    assert.equal(flow.throughput.length, 10);
    assert.equal(flow.throughput[0].done, 1);
  });

  it("has nothing to say about an empty project", async () => {
    const flow = await getFlowReport(db, projectId, 12, NOW);
    assert.equal(flow.averagePerWeek, 0);
    assert.equal(flow.cycleTimeDays.p85, null);
    assert.deepEqual(flow.inProgress, []);
    assert.equal(flow.throughput.length, 13);
  });
});
