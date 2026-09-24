import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, listTickets, updateTicket } from "../../src/tickets/repository.js";
import { getTicketTimes } from "../../src/calculations/time.js";
import { listRevisions } from "../../src/revisions/repository.js";
import { getTagChangeLog } from "../../src/tags/audit.js";
import { createTag, listTags, renameTag } from "../../src/tags/repository.js";
import { assignTag, getTicketTags } from "../../src/tags/assignment.js";
import { exportCsv } from "../../src/export/csv.js";
import { exportJson } from "../../src/export/json.js";
import { importCsv } from "../../src/import/csv.js";
import { importJson } from "../../src/import/json.js";
import { createRelation, listProjectRelations } from "../../src/relations/repository.js";
import { getWeights, setWeights } from "../../src/weights/repository.js";

describe("round-trip", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "RoundTrip");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("CSV round-trip preserves ticket data", async () => {
    const t = await createTicket(db, { projectId, title: "Login", benefit: 8, penalty: 3, estimate: 5, risk: 2 });
    const tag = await createTag(db, projectId, "state", "backlog");
    await assignTag(db, t.id, tag.id);

    const csv = await exportCsv(db, projectId);

    // Import into a new project
    const project2 = await createProject(db, "Target");
    await importCsv(db, project2.id, csv);

    const imported = await listTickets(db, project2.id);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].title, "Login");
    assert.equal(imported[0].benefit, 8);
    assert.equal(imported[0].penalty, 3);
    assert.equal(imported[0].estimate, 5);
    assert.equal(imported[0].risk, 2);

    const importedTags = await getTicketTags(db, imported[0].id);
    assert.equal(importedTags.length, 1);
    assert.equal(importedTags[0].prefix, "state");
    assert.equal(importedTags[0].value, "backlog");
  });

  it("JSON round-trip preserves ticket data", async () => {
    const t = await createTicket(db, { projectId, title: "Signup", benefit: 5, penalty: 2, estimate: 3, risk: 1 });
    const tag = await createTag(db, projectId, "feature", "auth");
    await assignTag(db, t.id, tag.id);

    const data = await exportJson(db, projectId);
    const json = JSON.stringify(data);

    const project2 = await createProject(db, "Target2");
    await importJson(db, project2.id, json);

    const imported = await listTickets(db, project2.id);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].title, "Signup");
    assert.equal(imported[0].benefit, 5);

    const importedTags = await getTicketTags(db, imported[0].id);
    assert.equal(importedTags.length, 1);
    assert.equal(importedTags[0].prefix, "feature");
    assert.equal(importedTags[0].value, "auth");
  });

  it("JSON round-trip preserves relations and weights", async () => {
    const a = await createTicket(db, { projectId, title: "A" });
    const b = await createTicket(db, { projectId, title: "B" });
    await createRelation(db, projectId, a.id, b.id, "blocks");
    await createRelation(db, projectId, a.id, b.id, "relates-to");
    await setWeights(db, projectId, 3, 1, 2, 0.5);

    const json = JSON.stringify(await exportJson(db, projectId));
    const target = await createProject(db, "Target");
    await importJson(db, target.id, json);
    await importJson(db, target.id, JSON.stringify({ tickets: [], relations: JSON.parse(json).relations }));

    const relations = (await listProjectRelations(db, target.id)).map((r) => [r.source_title, r.relation_type, r.target_title]);
    assert.deepEqual(relations, [["A", "blocks", "B"], ["A", "relates-to", "B"]]);
    const { w1, w2, w3, w4 } = await getWeights(db, target.id);
    assert.deepEqual([w1, w2, w3, w4], [3, 1, 2, 0.5]);
  });

  it("JSON import rejects relations to unknown tickets and invalid weights", async () => {
    await assert.rejects(
      importJson(db, projectId, JSON.stringify({ tickets: [], relations: [{ source: "X", type: "blocks", target: "Y" }] })),
      /Relation 1: ticket "X" not found/
    );
    await assert.rejects(
      importJson(db, projectId, JSON.stringify({ tickets: [], weights: { w1: 1, w2: 1, w3: 0, w4: 0 } })),
      /Weights: /
    );
  });

  it("JSON round-trip with history restores creation time, revisions and tag changes", async () => {
    const t = await createTicket(db, { projectId, title: "Hist", benefit: 3 });
    await updateTicket(db, projectId, t.id, { benefit: 8 });
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "wip")).id);
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "done")).id);
    await db.run("UPDATE tickets SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", t.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-01-03T00:00:00.000Z' WHERE ticket_id = ? AND value = 'wip'", t.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-01-11T00:00:00.000Z' WHERE ticket_id = ? AND value = 'done'", t.id);

    const json = JSON.stringify(await exportJson(db, projectId, { withHistory: true }));
    const target = await createProject(db, "Target");
    await importJson(db, target.id, json);

    const [copy] = await listTickets(db, target.id);
    assert.equal(copy.created_at, "2026-01-01T00:00:00.000Z");
    const times = await getTicketTimes(db, copy.id);
    assert.deepEqual([times.leadTimeDays, times.cycleTimeDays], [10, 8]);
    assert.deepEqual((await listRevisions(db, copy.id)).map((r) => r.benefit), [3]);
    assert.deepEqual(
      (await getTagChangeLog(db, copy.id)).map((c) => `${c.action} ${c.value}`),
      (await getTagChangeLog(db, t.id)).map((c) => `${c.action} ${c.value}`)
    );
  });

  it("JSON import rejects malformed history", async () => {
    await assert.rejects(
      importJson(db, projectId, JSON.stringify({ tickets: [{ title: "X", createdAt: "yesterday" }] })),
      /Ticket 1: createdAt must be an ISO timestamp/
    );
    await assert.rejects(
      importJson(db, projectId, JSON.stringify({ tickets: [{ title: "X", tagChanges: [{ action: "moved", prefix: "a", value: "b", changed_at: "2026-01-01" }] }] })),
      /Ticket 1: tag change 1: action must be/
    );
  });

  it("JSON round-trip with history keeps lead times and tags when a tag was renamed", async () => {
    const t = await createTicket(db, { projectId, title: "Renamed" });
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "wip")).id);
    const complete = await createTag(db, projectId, "state", "complete");
    await assignTag(db, t.id, complete.id);
    await renameTag(db, projectId, complete.id, "state", "done");

    const json = JSON.stringify(await exportJson(db, projectId, { withHistory: true }));
    const target = await createProject(db, "Target");
    await importJson(db, target.id, json);

    const [copy] = await listTickets(db, target.id);
    const times = await getTicketTimes(db, copy.id);
    assert.equal(times.leadTimeDays, 0);
    assert.equal(times.cycleTimeDays, 0);
    assert.deepEqual((await listTags(db, target.id)).map((tag) => tag.value), ["done", "wip"]);
    assert.deepEqual((await getTagChangeLog(db, copy.id)).map((c) => `${c.action} ${c.value}`), ["added wip", "removed wip", "added complete"]);
  });

  it("JSON import skips symmetric relations that already exist, in either order", async () => {
    const b = await createTicket(db, { projectId, title: "B" });
    const a = await createTicket(db, { projectId, title: "A" });
    await createRelation(db, projectId, a.id, b.id, "relates-to");

    const relations = [
      { source: "A", type: "relates-to", target: "B" },
      { source: "B", type: "relates-to", target: "A" },
    ];
    await importJson(db, projectId, JSON.stringify({ tickets: [], relations }));
    assert.equal((await listProjectRelations(db, projectId)).length, 1);
  });

  it("JSON import names the relation it cannot create", async () => {
    const tickets = [{ title: "A" }, { title: "B" }];
    const relations = [
      { source: "A", type: "blocks", target: "B" },
      { source: "B", type: "blocks", target: "A" },
    ];
    await assert.rejects(importJson(db, projectId, JSON.stringify({ tickets, relations })), /Relation 2: The reverse relation already exists/);
    await assert.rejects(
      importJson(db, projectId, JSON.stringify({ tickets, relations: [{ source: "A", type: "blocks", target: "A" }] })),
      /Relation 1: A ticket cannot relate to itself/
    );
  });

  it("JSON import rejects history that could not have happened", async () => {
    const ticket = (extra: Record<string, unknown>) =>
      JSON.stringify({ tickets: [{ title: "F", tags: [{ prefix: "state", value: "done" }], ...extra }] });
    const done = (changed_at: string) => ({ action: "added", prefix: "state", value: "done", changed_at });
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ createdAt: "2026-06-01T00:00:00Z", tagChanges: [done("2026-01-01T00:00:00Z")] }, /tag change 1 changed_at is before createdAt/],
      [{ createdAt: "2999-01-01T00:00:00Z" }, /createdAt is in the future/],
      [{ tagChanges: [done("2026-02-01T00:00:00Z"), { ...done("2026-01-01T00:00:00Z"), action: "removed" }] }, /tag change 2 is earlier/],
      [{ tagChanges: [{ action: "added", prefix: "state", value: "x", changed_at: "2026-01-01T00:00:00Z" }] }, /do not end in the ticket's tags/],
      [{ tagChanges: [{ ...done("2026-01-01T00:00:00Z"), action: "removed" }] }, /state:done is removed but was not there/],
    ];
    for (const [extra, message] of cases) {
      await assert.rejects(importJson(db, projectId, ticket(extra)), message, JSON.stringify(extra));
    }
    assert.equal((await listTickets(db, projectId)).length, 0);
  });

  it("JSON import reports a string score in a revision as not a number", async () => {
    const revisions = [{ title: "R", benefit: "5", penalty: 1, estimate: 1, risk: 1, tags: [], revised_at: "2026-01-01T00:00:00Z" }];
    await assert.rejects(
      importJson(db, projectId, JSON.stringify({ tickets: [{ title: "R", revisions }] })),
      /Ticket 1: revision 1 benefit must be a number, got "5"/
    );
  });
});
