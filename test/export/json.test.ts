import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { createRevision } from "../../src/revisions/repository.js";
import { exportJson } from "../../src/export/json.js";

describe("JSON export", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "JsonExport");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("exports empty project", async () => {
    const data = await exportJson(db, projectId);
    expect(data.tickets).toHaveLength(0);
    expect(data.tags).toHaveLength(0);
  });

  it("exports tickets and tags", async () => {
    const ticket = await createTicket(db, { projectId, title: "Feature X", benefit: 5, penalty: 3, estimate: 8, risk: 2 });
    const tag = await createTag(db, projectId, "feature", "auth");
    await assignTag(db, ticket.id, tag.id);

    const data = await exportJson(db, projectId);
    expect(data.tickets).toHaveLength(1);
    expect(data.tickets[0].title).toBe("Feature X");
    expect(data.tickets[0].tags).toEqual([{ prefix: "feature", value: "auth" }]);
    expect(data.tags).toEqual([{ prefix: "feature", value: "auth" }]);
  });

  it("includes history when requested", async () => {
    const ticket = await createTicket(db, { projectId, title: "Rev", benefit: 3, penalty: 2, estimate: 5, risk: 3 });
    await createRevision(db, ticket);
    await updateTicket(db, projectId, ticket.id, { benefit: 8 });

    const data = await exportJson(db, projectId, { withHistory: true });
    expect(data.tickets[0].revisions).toBeDefined();
    expect(data.tickets[0].revisions!.length).toBe(1);
  });

  it("does not include history by default", async () => {
    const ticket = await createTicket(db, { projectId, title: "NoHist", benefit: 3, penalty: 2, estimate: 5, risk: 3 });
    await createRevision(db, ticket);

    const data = await exportJson(db, projectId);
    expect(data.tickets[0].revisions).toBeUndefined();
  });

  it("is project-scoped", async () => {
    const project2 = await createProject(db, "Other");
    await createTicket(db, { projectId, title: "A" });
    await createTicket(db, { projectId: project2.id, title: "B" });

    const data = await exportJson(db, projectId);
    expect(data.tickets).toHaveLength(1);
    expect(data.tickets[0].title).toBe("A");
  });
});
