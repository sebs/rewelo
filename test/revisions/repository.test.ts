import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { createRevision, listRevisions } from "../../src/revisions/repository.js";

describe("ticket revisions", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates a revision before updating scores", async () => {
    const ticket = await createTicket(db, {
      projectId,
      title: "Login page",
      benefit: 3,
      penalty: 2,
      estimate: 5,
      risk: 3,
    });

    await createRevision(db, ticket);
    await updateTicket(db, projectId, ticket.id, { benefit: 8 });

    const revisions = await listRevisions(db, ticket.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].benefit).toBe(3);
    expect(revisions[0].penalty).toBe(2);
    expect(revisions[0].estimate).toBe(5);
    expect(revisions[0].risk).toBe(3);
  });

  it("captures tag snapshot in revision", async () => {
    const ticket = await createTicket(db, { projectId, title: "Login page" });
    const tag = await createTag(db, projectId, "state", "backlog");
    await assignTag(db, ticket.id, tag.id);

    await createRevision(db, ticket);

    const revisions = await listRevisions(db, ticket.id);
    expect(revisions[0].tags).toEqual([{ prefix: "state", value: "backlog" }]);
  });

  it("creates multiple revisions in order", async () => {
    const ticket = await createTicket(db, {
      projectId,
      title: "Login page",
      benefit: 3,
      penalty: 2,
      estimate: 5,
      risk: 3,
    });

    await createRevision(db, ticket);
    const updated = await updateTicket(db, projectId, ticket.id, {
      benefit: 5,
      penalty: 3,
    });

    await createRevision(db, updated);
    await updateTicket(db, projectId, ticket.id, { benefit: 8 });

    const revisions = await listRevisions(db, ticket.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].benefit).toBe(3);
    expect(revisions[1].benefit).toBe(5);
  });

  it("stores previous title in revision", async () => {
    const ticket = await createTicket(db, { projectId, title: "Login page" });

    await createRevision(db, ticket);
    await updateTicket(db, projectId, ticket.id, { title: "Login page v2" });

    const revisions = await listRevisions(db, ticket.id);
    expect(revisions[0].title).toBe("Login page");
  });
});
