import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createRelation } from "../../src/relations/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { createTag } from "../../src/tags/repository.js";
import { planCapacity } from "../../src/app/capacity-plan.js";
import type { Fibonacci } from "../../src/domain/scores.js";

describe("capacity plan", () => {
  let db: DB;
  let projectId: number;
  const id: Record<string, number> = {};

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Acme")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  // Penalty and risk 1 unless given: priority (benefit + 1) / (estimate + risk)
  async function tickets(...list: Array<[title: string, benefit: number, estimate: number, risk?: number]>) {
    for (const [title, benefit, estimate, risk = 1] of list) {
      id[title] = (await createTicket(db, { projectId, title, benefit: benefit as Fibonacci, penalty: 1, estimate: estimate as Fibonacci, risk: risk as Fibonacci })).id;
    }
  }
  const titles = (plan: Awaited<ReturnType<typeof planCapacity>>) => plan.tickets.map((t) => t.title);

  it("takes the tickets by priority while they fit, and goes on with smaller ones", async () => {
    // Ranked A 5.5, C 3, B 2.44, D 1.33, E 0.14
    await tickets(["A", 21, 3], ["B", 21, 8], ["C", 5, 1], ["D", 3, 2], ["E", 1, 13]);
    const plan = await planCapacity(db, projectId, { capacity: 6 });
    assert.deepEqual(titles(plan), ["A", "C", "D"]);
    assert.deepEqual([plan.used, plan.remaining], [6, 0]);
    assert.deepEqual(plan.tickets.map((t) => [t.rank, t.effort]), [[1, 3], [2, 1], [4, 2]]);
    // B didn't fit; E, ranked below the last planned ticket, isn't named
    assert.deepEqual(plan.skipped, [{ title: "B", rank: 3, effort: 8, needs: 8 }]);
  });

  it("schedules a ticket's open blockers before it, and counts them", async () => {
    await tickets(["Top", 21, 2], ["Mid", 13, 2], ["Base", 1, 3], ["Root", 1, 1]);
    await createRelation(db, projectId, id.Base, id.Top, "blocks");
    await createRelation(db, projectId, id.Base, id.Root, "depends-on");
    const plan = await planCapacity(db, projectId, { capacity: 8 });
    assert.deepEqual(titles(plan), ["Root", "Base", "Top", "Mid"]);
    assert.deepEqual(plan.tickets.map((t) => t.for), [["Top"], ["Top"], undefined, undefined]);
    assert.equal(plan.used, 8);
  });

  it("skips a ticket whose blockers don't fit with it, without planning the blockers", async () => {
    await tickets(["Top", 21, 2], ["Mid", 13, 2], ["Base", 1, 5]);
    await createRelation(db, projectId, id.Base, id.Top, "blocks");
    const plan = await planCapacity(db, projectId, { capacity: 5 });
    assert.deepEqual(titles(plan), ["Mid"]);
    assert.deepEqual(plan.skipped, [{ title: "Top", rank: 1, effort: 2, needs: 7 }]);
  });

  it("leaves out done tickets, and doesn't pull in a done blocker", async () => {
    await tickets(["Top", 21, 2], ["Old", 13, 2], ["Base", 1, 3]);
    await createRelation(db, projectId, id.Base, id.Top, "blocks");
    const done = await createTag(db, projectId, "state", "done");
    await assignTag(db, id.Old, done.id);
    await assignTag(db, id.Base, done.id);
    assert.deepEqual(titles(await planCapacity(db, projectId, { capacity: 10 })), ["Top"]);
  });

  it("measures effort as cost (estimate + risk) when asked", async () => {
    // A 4.4, B 2
    await tickets(["A", 21, 2, 3], ["B", 3, 1, 1]);
    const plan = await planCapacity(db, projectId, { capacity: 4, effort: "cost" });
    assert.deepEqual(plan.tickets.map((t) => [t.title, t.effort]), [["B", 2]]);
    assert.deepEqual(plan.skipped, [{ title: "A", rank: 1, effort: 5, needs: 5 }]);
  });

  it("ranks within a tag scope, and pulls in a blocker from outside it without a rank", async () => {
    await tickets(["In", 21, 2], ["Other", 13, 1], ["Base", 1, 1]);
    const team = await createTag(db, projectId, "team", "x");
    await assignTag(db, id.In, team.id);
    await createRelation(db, projectId, id.Base, id.In, "blocks");
    const plan = await planCapacity(db, projectId, { capacity: 10, tags: ["team:x"] });
    assert.deepEqual(plan.tickets.map((t) => [t.title, t.rank]), [["Base", null], ["In", 1]]);
  });

  it("leaves out tickets with an excluded tag, but still pulls one in as a blocker", async () => {
    await tickets(["Wip", 21, 1], ["Top", 13, 1], ["Next", 8, 1]);
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, id.Wip, wip.id);
    assert.deepEqual(titles(await planCapacity(db, projectId, { capacity: 10, excludeTags: ["state:wip"] })), ["Top", "Next"]);
    await createRelation(db, projectId, id.Wip, id.Next, "blocks");
    const plan = await planCapacity(db, projectId, { capacity: 10, excludeTags: ["state:wip"] });
    assert.deepEqual(plan.tickets.map((t) => [t.title, t.rank, t.for]), [["Top", 1, undefined], ["Wip", null, ["Next"]], ["Next", 2, undefined]]);
  });

  it("refuses a capacity that isn't a positive number", async () => {
    for (const capacity of [0, -1, Number.NaN, Infinity]) {
      await assert.rejects(planCapacity(db, projectId, { capacity }), /capacity must be a positive number/);
    }
  });
});
