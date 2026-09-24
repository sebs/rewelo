import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { getTagChangeLog } from "../../src/tags/audit.js";
import { createRevision, listRevisions } from "../../src/revisions/repository.js";

describe("audit log integrity", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "AuditTest");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("tag assign creates exactly one audit entry", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");
    await assignTag(db, ticket.id, tag.id);

    const log = await getTagChangeLog(db, ticket.id);
    assert.equal(log.length, 1);
    assert.equal(log[0].action, "added");
  });

  it("idempotent tag assign does not create duplicate audit entry", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");

    await assignTag(db, ticket.id, tag.id);
    const second = await assignTag(db, ticket.id, tag.id);
    assert.equal(second.assigned, false);

    const log = await getTagChangeLog(db, ticket.id);
    assert.equal(log.length, 1); // Still just one entry
  });

  it("remove unassigned tag returns false and creates no audit entry", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");

    const removed = await removeTag(db, ticket.id, tag.id);
    assert.equal(removed, false);

    const log = await getTagChangeLog(db, ticket.id);
    assert.equal(log.length, 0);
  });

  it("revision timestamps are server-generated", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1", benefit: 3, penalty: 2, estimate: 5, risk: 3 });
    await createRevision(db, ticket);

    const revisions = await listRevisions(db, ticket.id);
    assert.equal(revisions.length, 1);
    // Timestamp should be a valid ISO-ish string set by the database
    assert.notEqual(revisions[0].revised_at, undefined);
    assert.ok(!Number.isNaN(new Date(revisions[0].revised_at).getTime()));
  });

  it("audit entries have server-generated timestamps", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "wip");
    await assignTag(db, ticket.id, tag.id);

    const log = await getTagChangeLog(db, ticket.id);
    assert.notEqual(log[0].changed_at, undefined);
    assert.ok(!Number.isNaN(new Date(log[0].changed_at).getTime()));
  });

  it("full tag lifecycle creates correct audit trail", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");

    await assignTag(db, ticket.id, tag.id);
    await removeTag(db, ticket.id, tag.id);
    await assignTag(db, ticket.id, tag.id);

    const log = await getTagChangeLog(db, ticket.id);
    assert.equal(log.length, 3);
    assert.deepEqual(log.map((l) => l.action), ["added", "removed", "added"]);
  });
});
