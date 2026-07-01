import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createRelation } from "../../src/relations/repository.js";
import { renderDashboard } from "../../src/reports/dashboard.js";

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

  it("renders a self-contained HTML document for an empty project", async () => {
    const html = await renderDashboard(db, projectId, "DashTest");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("DashTest");
    // No external assets (fully self-contained).
    expect(html).not.toMatch(/src=|href=|<script/i);
    expect(html).toContain("No tickets yet.");
  });

  it("includes ticket rows sorted by priority and the relationships", async () => {
    const low = await createTicket(db, { projectId, title: "Low ROI", benefit: 1, penalty: 1, estimate: 8, risk: 8 });
    const high = await createTicket(db, { projectId, title: "Quick win", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    await createRelation(db, projectId, high.id, low.id, "blocks");

    const html = await renderDashboard(db, projectId, "DashTest");
    expect(html).toContain("Quick win");
    expect(html).toContain("Low ROI");
    // Highest-priority ticket appears before the lower one.
    expect(html.indexOf("Quick win")).toBeLessThan(html.indexOf("Low ROI"));
    expect(html).toContain("blocks");
  });

  it("escapes HTML in ticket titles", async () => {
    await createTicket(db, { projectId, title: "<b>xss</b>", benefit: 2, penalty: 1, estimate: 1, risk: 1 });
    const html = await renderDashboard(db, projectId, "DashTest");
    expect(html).toContain("&lt;b&gt;xss&lt;/b&gt;");
    expect(html).not.toContain("<b>xss</b>");
  });
});
