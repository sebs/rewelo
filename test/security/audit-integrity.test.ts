import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("added");
  });

  it("idempotent tag assign does not create duplicate audit entry", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");

    await assignTag(db, ticket.id, tag.id);
    const second = await assignTag(db, ticket.id, tag.id);
    expect(second).toBe(false);

    const log = await getTagChangeLog(db, ticket.id);
    expect(log).toHaveLength(1); // Still just one entry
  });

  it("remove unassigned tag returns false and creates no audit entry", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");

    const removed = await removeTag(db, ticket.id, tag.id);
    expect(removed).toBe(false);

    const log = await getTagChangeLog(db, ticket.id);
    expect(log).toHaveLength(0);
  });

  it("revision timestamps are server-generated", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1", benefit: 3, penalty: 2, estimate: 5, risk: 3 });
    await createRevision(db, ticket);

    const revisions = await listRevisions(db, ticket.id);
    expect(revisions).toHaveLength(1);
    // Timestamp should be a valid ISO-ish string set by the database
    expect(revisions[0].revised_at).toBeDefined();
    expect(new Date(revisions[0].revised_at).getTime()).not.toBeNaN();
  });

  it("audit entries have server-generated timestamps", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "wip");
    await assignTag(db, ticket.id, tag.id);

    const log = await getTagChangeLog(db, ticket.id);
    expect(log[0].changed_at).toBeDefined();
    expect(new Date(log[0].changed_at).getTime()).not.toBeNaN();
  });

  it("full tag lifecycle creates correct audit trail", async () => {
    const ticket = await createTicket(db, { projectId, title: "T1" });
    const tag = await createTag(db, projectId, "state", "backlog");

    await assignTag(db, ticket.id, tag.id);
    await removeTag(db, ticket.id, tag.id);
    await assignTag(db, ticket.id, tag.id);

    const log = await getTagChangeLog(db, ticket.id);
    expect(log).toHaveLength(3);
    expect(log.map((l) => l.action)).toEqual(["added", "removed", "added"]);
  });
});
