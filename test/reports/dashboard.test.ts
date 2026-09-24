import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
    assert.ok(html.includes("<!doctype html>"));
    assert.ok(html.includes("DashTest"));
    // No external assets (fully self-contained).
    assert.doesNotMatch(html, /src=|href=|<script/i);
    assert.ok(html.includes("No tickets yet."));
  });

  it("includes ticket rows sorted by priority and the relationships", async () => {
    const low = await createTicket(db, { projectId, title: "Low ROI", benefit: 1, penalty: 1, estimate: 8, risk: 8 });
    const high = await createTicket(db, { projectId, title: "Quick win", benefit: 13, penalty: 8, estimate: 1, risk: 1 });
    await createRelation(db, projectId, high.id, low.id, "blocks");

    const html = await renderDashboard(db, projectId, "DashTest");
    assert.ok(html.includes("Quick win"));
    assert.ok(html.includes("Low ROI"));
    // Highest-priority ticket appears before the lower one.
    assert.ok(html.indexOf("Quick win") < html.indexOf("Low ROI"));
    assert.ok(html.includes("blocks"));
  });

  it("escapes HTML in ticket titles", async () => {
    await createTicket(db, { projectId, title: "<b>xss</b>", benefit: 2, penalty: 1, estimate: 1, risk: 1 });
    const html = await renderDashboard(db, projectId, "DashTest");
    assert.ok(html.includes("&lt;b&gt;xss&lt;/b&gt;"));
    assert.ok(!html.includes("<b>xss</b>"));
  });

  it("describes a missing low-priority count like rw report health", async () => {
    await createTicket(db, { projectId, title: "Only high", benefit: 21 });
    const html = await renderDashboard(db, projectId, "Dash");
    assert.ok(html.includes("n/a (no low-priority tickets)"));
    assert.ok(!html.includes("&infin;"));
  });
});
