import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { createRevision } from "../../src/revisions/repository.js";
import { getProjectDiff } from "../../src/reports/diff.js";

describe("project diff", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Diff");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty diff when nothing changed", async () => {
    const diff = await getProjectDiff(db, projectId, "2099-01-01T00:00:00Z");
    expect(diff.newTickets).toHaveLength(0);
    expect(diff.updatedTickets).toHaveLength(0);
    expect(diff.tagChanges).toHaveLength(0);
  });

  it("detects new tickets since timestamp", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    await createTicket(db, { projectId, title: "Fresh", benefit: 8, penalty: 5, estimate: 2, risk: 1 });

    const diff = await getProjectDiff(db, projectId, before);
    expect(diff.newTickets).toHaveLength(1);
    expect(diff.newTickets[0].title).toBe("Fresh");
    expect(diff.newTickets[0].priority).toBeGreaterThan(0);
  });

  it("detects score changes via revisions", async () => {
    const t = await createTicket(db, { projectId, title: "Scored", benefit: 3, penalty: 2, estimate: 1, risk: 1 });
    const before = new Date().toISOString();
    await createRevision(db, t);
    await updateTicket(db, projectId, t.id, { benefit: 13 });

    const diff = await getProjectDiff(db, projectId, before);
    expect(diff.updatedTickets).toHaveLength(1);
    expect(diff.updatedTickets[0].title).toBe("Scored");
    const benefitChange = diff.updatedTickets[0].changes.find((c) => c.field === "benefit");
    expect(benefitChange).toBeDefined();
    expect(benefitChange!.from).toBe(3);
    expect(benefitChange!.to).toBe(13);
  });

  it("detects tag additions and removals", async () => {
    const t = await createTicket(db, { projectId, title: "Tagged" });
    const tag = await createTag(db, projectId, "state", "wip");
    const before = new Date().toISOString();
    await assignTag(db, t.id, tag.id);
    await removeTag(db, t.id, tag.id);

    const diff = await getProjectDiff(db, projectId, before);
    expect(diff.tagChanges).toHaveLength(1);
    expect(diff.tagChanges[0].added).toContain("state:wip");
    expect(diff.tagChanges[0].removed).toContain("state:wip");
  });

  it("ignores changes before the since timestamp", async () => {
    const t = await createTicket(db, { projectId, title: "Old", benefit: 3 });
    await createRevision(db, t);
    await updateTicket(db, projectId, t.id, { benefit: 8 });

    const diff = await getProjectDiff(db, projectId, "2099-01-01T00:00:00Z");
    expect(diff.newTickets).toHaveLength(0);
    expect(diff.updatedTickets).toHaveLength(0);
  });

  it("collapses multiple revisions into one diff per ticket", async () => {
    const t = await createTicket(db, { projectId, title: "Multi", benefit: 1, penalty: 1 });
    const before = new Date().toISOString();

    await createRevision(db, t);
    const t2 = await updateTicket(db, projectId, t.id, { benefit: 5 });
    await createRevision(db, t2);
    await updateTicket(db, projectId, t.id, { benefit: 13 });

    const diff = await getProjectDiff(db, projectId, before);
    expect(diff.updatedTickets).toHaveLength(1);
    // Should diff from original (1) to current (13)
    const benefitChange = diff.updatedTickets[0].changes.find((c) => c.field === "benefit");
    expect(benefitChange!.from).toBe(1);
    expect(benefitChange!.to).toBe(13);
  });
});
