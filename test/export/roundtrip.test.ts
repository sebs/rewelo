import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, listTickets } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
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
});
