import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { dailyDone, forecastFromDaily, forecastText, getForecast, simulate } from "../../src/reports/forecast.js";

const NOW = new Date("2026-03-11T12:00:00.000Z");

describe("forecast", () => {
  it("at a steady pace, every run takes the same time", () => {
    const f = forecastFromDaily(new Array(30).fill(2), 10, NOW);
    assert.deepEqual(f.outcomes, [
      { likelihood: 50, days: 5, date: "2026-03-16" },
      { likelihood: 85, days: 5, date: "2026-03-16" },
      { likelihood: 95, days: 5, date: "2026-03-16" },
    ]);
    assert.equal(f.doneInHistory, 60);
  });

  it("is later the more likely it has to be, at an uneven pace", () => {
    const f = forecastFromDaily([1, 0, 0, 2, 0, 0, 0, 0, 1], 10, NOW);
    const [p50, p85, p95] = f.outcomes.map((o) => o.days!);
    assert.ok(p50 <= p85 && p85 <= p95, `${p50} ${p85} ${p95}`);
    // 4 tickets in 9 days: about 22 days for 10
    assert.ok(p50 > 15 && p50 < 35, `p50 ${p50}`);
    assert.ok(p95 > p50);
  });

  it("gives the same answer for the same data", () => {
    const daily = [0, 1, 3, 0, 2, 0, 1];
    assert.deepEqual(forecastFromDaily(daily, 25, NOW), forecastFromDaily(daily, 25, NOW));
    assert.deepEqual(simulate(daily, 5, 100), simulate(daily, 5, 100));
  });

  it("has no outcomes without a pace, and needs none for nothing", () => {
    const stalled = forecastFromDaily([0, 0, 0], 4, NOW);
    assert.deepEqual(stalled.outcomes, []);
    assert.equal(forecastText(stalled), "No ticket was done in the last 3 days: there is no pace to forecast 4 tickets from.");
    assert.equal(forecastFromDaily([0, 0], 0, NOW).outcomes[0].days, 0);
    assert.equal(forecastText(forecastFromDaily([1], 0, NOW)), "No open tickets to forecast.");
  });

  it("says when it isn't within ten years", () => {
    const daily = new Array(1000).fill(0);
    daily[0] = 1;
    const f = forecastFromDaily(daily, 50, NOW, 200);
    assert.deepEqual(f.outcomes[2], { likelihood: 95, days: null, date: null });
    assert.match(forecastText(f), /95% by \(not within ten years\)/);
  });

  it("counts the done tickets per day before today, oldest first", () => {
    const at = (iso: string) => new Date(iso).getTime();
    assert.deepEqual(dailyDone([at("2026-03-08T01:00:00Z"), at("2026-03-10T23:00:00Z"), at("2026-03-10T01:00:00Z"), at("2026-03-11T08:00:00Z")], 3, NOW), [1, 0, 2]);
  });
});

describe("getForecast", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Pace")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("forecasts the open tickets at the pace of the last days", async () => {
    const done = (await createTag(db, projectId, "state", "done")).id;
    for (let i = 0; i < 6; i++) {
      const t = await createTicket(db, { projectId, title: `Done ${i}` });
      await assignTag(db, t.id, done);
      // One a day, the six days before today
      await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ?", new Date(NOW.getTime() - (i + 1) * 86_400_000).toISOString(), t.id);
    }
    for (let i = 0; i < 3; i++) await createTicket(db, { projectId, title: `Open ${i}` });

    const f = await getForecast(db, projectId, { historyDays: 6, now: NOW });
    assert.equal(f.items, 3);
    assert.equal(f.doneInHistory, 6);
    assert.deepEqual(f.outcomes.map((o) => o.date), ["2026-03-14", "2026-03-14", "2026-03-14"]);
    assert.equal((await getForecast(db, projectId, { items: 12, historyDays: 6, now: NOW })).outcomes[0].days, 12);
  });
});
