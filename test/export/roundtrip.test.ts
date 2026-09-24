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
});
