import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { createRelation } from "../../src/relations/repository.js";
import { getDashboardData } from "../../src/reports/dashboard.js";
import { renderDashboardHtml } from "../../src/reports/dashboard-template.js";

describe("dashboard report", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "DashTest");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty dashboard for empty project", async () => {
    const data = await getDashboardData(db, projectId, "DashTest");
    expect(data.projectName).toBe("DashTest");
    expect(data.tickets).toHaveLength(0);
    expect(data.relations).toHaveLength(0);
    expect(data.summary.totalTickets).toBe(0);
    expect(data.health.totalTickets).toBe(0);
  });

  it("includes all tickets with calculated fields", async () => {
    await createTicket(db, { projectId, title: "A", benefit: 13, penalty: 8, estimate: 2, risk: 1 });
    await createTicket(db, { projectId, title: "B", benefit: 1, penalty: 1, estimate: 8, risk: 5 });

    const data = await getDashboardData(db, projectId, "DashTest");
    expect(data.tickets).toHaveLength(2);

    const a = data.tickets.find((t) => t.title === "A")!;
    expect(a.value).toBe(21);
    expect(a.cost).toBe(3);
    expect(a.priority).toBe(7);

    const b = data.tickets.find((t) => t.title === "B")!;
    expect(b.value).toBe(2);
    expect(b.cost).toBe(13);
  });

  it("includes state from tags", async () => {
    const t1 = await createTicket(db, { projectId, title: "WIP" });
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, t1.id, wip.id);

    const data = await getDashboardData(db, projectId, "DashTest");
    expect(data.tickets[0].state).toBe("wip");
  });

  it("defaults state to untagged", async () => {
    await createTicket(db, { projectId, title: "NoState" });
    const data = await getDashboardData(db, projectId, "DashTest");
    expect(data.tickets[0].state).toBe("untagged");
  });

  it("includes relations", async () => {
    const t1 = await createTicket(db, { projectId, title: "Parent" });
    const t2 = await createTicket(db, { projectId, title: "Child" });
    await createRelation(db, projectId, t1.id, t2.id, "blocks");

    const data = await getDashboardData(db, projectId, "DashTest");
    expect(data.relations.length).toBeGreaterThanOrEqual(1);
    const rel = data.relations.find((r) => r.type === "blocks");
    expect(rel).toBeDefined();
    expect(rel!.sourceTitle).toBe("Parent");
    expect(rel!.targetTitle).toBe("Child");
  });

  it("deduplicates inverse relations", async () => {
    const t1 = await createTicket(db, { projectId, title: "A" });
    const t2 = await createTicket(db, { projectId, title: "B" });
    await createRelation(db, projectId, t1.id, t2.id, "blocks");
    // This also creates an inverse "is-blocked-by" row in the DB

    const data = await getDashboardData(db, projectId, "DashTest");
    // Should not have both "blocks" and "is-blocked-by" for the same pair
    const pairRelations = data.relations.filter(
      (r) =>
        (r.sourceId === t1.id && r.targetId === t2.id) ||
        (r.sourceId === t2.id && r.targetId === t1.id)
    );
    expect(pairRelations).toHaveLength(1);
  });

  it("renders valid HTML", async () => {
    await createTicket(db, { projectId, title: "Test", benefit: 5, penalty: 3, estimate: 3, risk: 2 });
    const data = await getDashboardData(db, projectId, "DashTest");
    const html = renderDashboardHtml(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("DashTest");
    expect(html).toContain("Test");
    expect(html).toContain("</html>");
  });

  it("escapes HTML in ticket titles", async () => {
    await createTicket(db, { projectId, title: "<script>alert(1)</script>" });
    const data = await getDashboardData(db, projectId, "DashTest");
    const html = renderDashboardHtml(data);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders graph section when relations exist", async () => {
    const t1 = await createTicket(db, { projectId, title: "Src" });
    const t2 = await createTicket(db, { projectId, title: "Tgt" });
    await createRelation(db, projectId, t1.id, t2.id, "depends-on");

    const data = await getDashboardData(db, projectId, "DashTest");
    const html = renderDashboardHtml(data);
    expect(html).toContain("graph-svg");
    expect(html).toContain("depends-on");
  });

  it("shows empty message for graph when no relations", async () => {
    await createTicket(db, { projectId, title: "Solo" });
    const data = await getDashboardData(db, projectId, "DashTest");
    const html = renderDashboardHtml(data);
    expect(html).toContain("No relations defined");
  });
});
