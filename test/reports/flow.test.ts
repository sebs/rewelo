import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { cumulativeFlow, flowEventsIn, getFlowEvents, getScoredFlowEvents, measureOf, MAX_FLOW_POINTS, type FlowEvents } from "../../src/reports/flow.js";
import { flowChartSvg, flowSummary } from "../../src/reports/flow-chart.js";

const at = (iso: string) => new Date(iso).getTime();
const NOW = new Date("2026-03-10T15:00:00.000Z");

describe("cumulativeFlow", () => {
  const events: FlowEvents = {
    arrived: [at("2026-03-01T10:00:00Z"), at("2026-03-02T10:00:00Z"), at("2026-03-02T11:00:00Z"), at("2026-03-08T09:00:00Z")],
    started: [at("2026-03-03T10:00:00Z"), at("2026-03-05T10:00:00Z")],
    done: [at("2026-03-06T23:59:59Z")],
  };

  it("counts what has arrived, started and is done at the end of each day", () => {
    const flow = cumulativeFlow(events, 0, NOW);
    assert.equal(flow.points.length, 10);
    assert.deepEqual(flow.points[0], { date: "2026-03-01", arrived: 1, started: 0, done: 0 });
    assert.deepEqual(flow.points[1], { date: "2026-03-02", arrived: 3, started: 0, done: 0 });
    assert.deepEqual(flow.points[5], { date: "2026-03-06", arrived: 3, started: 2, done: 1 });
    assert.deepEqual(flow.points[9], { date: "2026-03-10", arrived: 4, started: 2, done: 1 });
    assert.deepEqual(flow.start, { arrived: 0, started: 0, done: 0 });
  });

  it("covers the last days of a window, ending today, and counts what came before", () => {
    const flow = cumulativeFlow(events, 3, NOW);
    assert.deepEqual(flow.points.map((p) => p.date), ["2026-03-08", "2026-03-09", "2026-03-10"]);
    assert.deepEqual(flow.start, { arrived: 3, started: 2, done: 1 });
    assert.equal(flowSummary(flow), "Last 3 days: 1 arrived, 0 started, 0 done. At the end, 1 in progress and 2 not started.");
  });

  it("starts a window before the first ticket at zero", () => {
    const flow = cumulativeFlow(events, 14, NOW);
    assert.equal(flow.points.length, 14);
    assert.deepEqual(flow.points[0], { date: "2026-02-25", arrived: 0, started: 0, done: 0 });
  });

  it("has no points without tickets", () => {
    assert.deepEqual(cumulativeFlow({ arrived: [], started: [], done: [] }, 30, NOW).points, []);
    assert.deepEqual(cumulativeFlow({ arrived: [], started: [], done: [] }, 0, NOW).points, []);
  });

  it("sums what each event weighs in a measure", () => {
    const flow = cumulativeFlow({ ...events, measure: "value", weights: { arrived: [2, 3, 5, 8], started: [3, 5], done: [5] } }, 3, NOW);
    assert.equal(flow.measure, "value");
    assert.deepEqual(flow.start, { arrived: 10, started: 8, done: 5 });
    assert.deepEqual(flow.points[2], { date: "2026-03-10", arrived: 18, started: 8, done: 5 });
    assert.equal(flowSummary(flow), "Last 3 days, by value: 8 arrived, 0 started, 0 done. At the end, 3 in progress and 10 not started.");
    assert.equal(cumulativeFlow(events, 3, NOW).measure, "count");
  });

  it("samples a long history every few days, ending today", () => {
    const flow = cumulativeFlow({ arrived: [at("2020-01-01T00:00:00Z")], started: [], done: [] }, 0, NOW);
    assert.ok(flow.points.length <= MAX_FLOW_POINTS);
    assert.equal(flow.points[flow.points.length - 1].date, "2026-03-10");
  });
});

describe("flowChartSvg", () => {
  it("draws the three areas, one tooltip per day and an accessible name", () => {
    const flow = cumulativeFlow({ arrived: [at("2026-03-09T10:00:00Z")], started: [at("2026-03-10T10:00:00Z")], done: [] }, 2, NOW);
    const svg = flowChartSvg(flow);
    for (const key of ["arrived", "started", "done"]) assert.match(svg, new RegExp(`class="area ${key}"`));
    assert.equal(svg.match(/<title>/g)?.length, 2);
    assert.match(svg, /<title>2026-03-10: 1 arrived, 1 started, 0 done<\/title>/);
    assert.match(svg, /role="img" aria-label="Cumulative flow\. Last 2 days: 1 arrived, 1 started, 0 done\./);
    assert.doesNotMatch(svg, /NaN|Infinity/);
  });

  it("starts the y axis a little below the lowest done count, as DevOps Infinity does", () => {
    const many = (n: number, iso: string) => Array.from({ length: n }, () => at(iso));
    const flow = cumulativeFlow({ arrived: many(60, "2026-03-01T00:00:00Z"), started: many(50, "2026-03-01T00:00:00Z"), done: many(40, "2026-03-01T00:00:00Z") }, 3, NOW);
    const ticks = [...flowChartSvg(flow).matchAll(/class="tick" x="38"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
    assert.ok(ticks[0] > 0 && ticks[0] <= 37, `axis starts at ${ticks[0]}`);
    assert.ok(ticks[ticks.length - 1] >= 60);
  });

  it("draws a single day across the chart", () => {
    const flow = cumulativeFlow({ arrived: [at("2026-03-10T10:00:00Z")], started: [], done: [] }, 0, NOW);
    assert.equal(flow.points.length, 1);
    assert.doesNotMatch(flowChartSvg(flow), /NaN|Infinity/);
  });
});

describe("getFlowEvents", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Flow")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("follows the state rules of lead and cycle time", async () => {
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");
    const backlog = await createTag(db, projectId, "state", "backlog");

    const finished = await createTicket(db, { projectId, title: "Finished" });
    await assignTag(db, finished.id, wip.id);
    await assignTag(db, finished.id, done.id);
    // Done without being wip: started when done
    const direct = await createTicket(db, { projectId, title: "Straight to done" });
    await assignTag(db, direct.id, done.id);
    // Reopened: started, no longer done
    const reopened = await createTicket(db, { projectId, title: "Reopened" });
    await assignTag(db, reopened.id, done.id);
    await removeTag(db, reopened.id, done.id);
    await assignTag(db, reopened.id, wip.id);
    // Waiting
    const waiting = await createTicket(db, { projectId, title: "Waiting" });
    await assignTag(db, waiting.id, backlog.id);

    const events = await getFlowEvents(db, projectId);
    assert.equal(events.arrived.length, 4);
    assert.equal(events.started.length, 3);
    assert.equal(events.done.length, 2);
    assert.ok(events.arrived.every((t, i, all) => i === 0 || all[i - 1] <= t));
  });

  it("weighs each event by the ticket's score in a measure", async () => {
    const done = await createTag(db, projectId, "state", "done");
    const t = await createTicket(db, { projectId, title: "Big", benefit: 13, penalty: 8, estimate: 5, risk: 3 });
    await createTicket(db, { projectId, title: "Small", benefit: 1, penalty: 1, estimate: 1, risk: 1 });
    await assignTag(db, t.id, done.id);
    const scored = await getScoredFlowEvents(db, projectId);
    const value = flowEventsIn(scored, "value");
    assert.equal(value.measure, "value");
    assert.deepEqual([...value.weights!.arrived].sort((a, b) => a - b), [2, 21]);
    assert.deepEqual(value.weights!.done, [21]);
    assert.deepEqual(flowEventsIn(scored, "risk").weights!.started, [3]);
    // Counting needs no weights
    assert.equal(flowEventsIn(scored, "count").weights, undefined);
    const scores = { benefit: 13, penalty: 8, estimate: 5, risk: 3 };
    assert.deepEqual(["count", "benefit", "penalty", "estimate", "risk", "value", "cost"].map((m) => measureOf(m as never, scores)), [1, 13, 8, 5, 3, 21, 8]);
  });

  it("counts a ticket on the days it moved, from the change log", async () => {
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");
    const t = await createTicket(db, { projectId, title: "Story" });
    await assignTag(db, t.id, wip.id);
    await assignTag(db, t.id, done.id);
    await db.run("UPDATE tickets SET created_at = '2026-03-01T08:00:00.000Z' WHERE id = ?", t.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-03T08:00:00.000Z' WHERE ticket_id = ? AND value = 'wip'", t.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-07T08:00:00.000Z' WHERE ticket_id = ? AND value = 'done'", t.id);

    const flow = cumulativeFlow(await getFlowEvents(db, projectId), 0, NOW);
    const on = (date: string) => flow.points.find((p) => p.date === date);
    assert.deepEqual(on("2026-03-02"), { date: "2026-03-02", arrived: 1, started: 0, done: 0 });
    assert.deepEqual(on("2026-03-03"), { date: "2026-03-03", arrived: 1, started: 1, done: 0 });
    assert.deepEqual(on("2026-03-07"), { date: "2026-03-07", arrived: 1, started: 1, done: 1 });
  });
});
