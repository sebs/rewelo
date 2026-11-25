import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createRelation } from "../../src/relations/repository.js";
import { renderDashboard, renderDashboardHtml, type DashboardModel } from "../../src/reports/dashboard.js";
import { setWeights } from "../../src/weights/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";

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

  it("ranks open tickets only and says how many done ones it leaves out", async () => {
    const done = await createTicket(db, { projectId, title: "Done already" });
    await createTicket(db, { projectId, title: "Still open" });
    await assignTag(db, done.id, (await createTag(db, projectId, "state", "done")).id);
    const html = await renderDashboard(db, projectId, "Dash");
    assert.ok(!html.includes("<td>Done already</td>"));
    assert.ok(html.includes("<td>Still open</td>"));
    assert.ok(html.includes("1 done ticket is not listed."));
  });

  it("says the ranking is unweighted when the project has its own weights", async () => {
    await createTicket(db, { projectId, title: "A" });
    assert.ok(!(await renderDashboard(db, projectId, "Dash")).includes("without the project's weights"));
    await setWeights(db, projectId, { w1: 0.1, w2: 5, w3: 1.5, w4: 1.5 });
    assert.ok((await renderDashboard(db, projectId, "Dash")).includes("without the project's weights"));
  });

  it("caps the ticket and relation tables and says how many are left out", async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await createTicket(db, { projectId, title: `T${i}`, benefit: [1, 2, 3, 5][i] })).id);
    for (let i = 1; i < 4; i++) await createRelation(db, projectId, ids[0], ids[i], "blocks");

    const html = await renderDashboard(db, projectId, "DashTest", { limit: 2 });
    assert.equal(html.match(/<td class="n strong">/g)?.length, 2);
    assert.equal(html.match(/<td class="rel">/g)?.length, 2);
    assert.match(html, /Showing 2 of 4 open tickets/);
    assert.match(html, /Showing 2 of 3 relations/);

    const all = await renderDashboard(db, projectId, "DashTest");
    assert.doesNotMatch(all, /Showing/);
  });

  it("labels its tables and explains the score columns", async () => {
    await createTicket(db, { projectId, title: "A", benefit: 3 });
    const html = await renderDashboard(db, projectId, "DashTest");
    assert.equal(html.match(/<table aria-labelledby="(tickets|distribution|relations)">/g)?.length, 3);
    assert.doesNotMatch(html, /<th>/);
    assert.match(html, /<th scope="row">benefit<\/th>/);
    assert.match(html, /<abbr title="Benefit">B<\/abbr>/);
    assert.doesNotMatch(html, /#888;|#8880/);
  });

  it("doesn't call a backlog empty when --limit 0 hides its rows", async () => {
    const a = await createTicket(db, { projectId, title: "A" });
    const b = await createTicket(db, { projectId, title: "B" });
    await createRelation(db, projectId, a.id, b.id, "blocks");
    const html = await renderDashboard(db, projectId, "DashTest", { limit: 0 });
    assert.doesNotMatch(html, /No tickets yet|No relations defined/);
    assert.match(html, /Showing 0 of 2 open tickets/);
    assert.match(html, /Showing 0 of 1 relation;/);
  });

  it("marks relations with a done ticket, which its switch hides", async () => {
    const a = await createTicket(db, { projectId, title: "Open A" });
    const b = await createTicket(db, { projectId, title: "Open B" });
    const shipped = await createTicket(db, { projectId, title: "Shipped" });
    await createRelation(db, projectId, a.id, b.id, "relates-to");
    await createRelation(db, projectId, shipped.id, a.id, "blocks");
    await assignTag(db, shipped.id, (await createTag(db, projectId, "state", "done")).id);

    const html = await renderDashboard(db, projectId, "DashTest");
    assert.match(html, /<input type="checkbox" id="relations-open">Only between open tickets<\/label>/);
    assert.match(html, /<tr><td>Open A<\/td><td class="rel">relates-to<\/td><td>Open B<\/td><\/tr>/);
    assert.match(html, /<tr class="closed"><td>Shipped <span class="badge">done<\/span><\/td><td class="rel">blocks<\/td><td>Open A<\/td><\/tr>/);
    assert.match(html, /\.relations-card:has\(#relations-open:checked\) tr\.closed \{ display: none; \}/);
    // Some relation stays when the switch is on
    assert.doesNotMatch(html, /<tr class="none-open">/);
    // Still script-free
    assert.doesNotMatch(html, /<script/);
  });

  it("says when no relation is between open tickets", async () => {
    const a = await createTicket(db, { projectId, title: "A" });
    const b = await createTicket(db, { projectId, title: "B" });
    await createRelation(db, projectId, a.id, b.id, "blocks");
    await assignTag(db, b.id, (await createTag(db, projectId, "state", "done")).id);
    const html = await renderDashboard(db, projectId, "DashTest");
    assert.match(html, /<tr class="none-open"><td colspan="3" class="empty">No relation between open tickets\.<\/td><\/tr>/);
  });

  it("says there are no open tickets, not no tickets, when all are done", async () => {
    const t = await createTicket(db, { projectId, title: "Finished" });
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "done")).id);
    const html = await renderDashboard(db, projectId, "DashTest");
    assert.match(html, /No open tickets\./);
    assert.doesNotMatch(html, /No tickets yet/);
  });
});

describe("dashboard cumulative flow", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Flow")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("charts every window, ending on the day it was generated, the 30 days checked", async () => {
    const t = await createTicket(db, { projectId, title: "Story" });
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "wip")).id);
    await db.run("UPDATE tickets SET created_at = '2026-03-01T08:00:00.000Z' WHERE id = ?", t.id);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-04T08:00:00.000Z' WHERE ticket_id = ?", t.id);

    const html = await renderDashboard(db, projectId, "Flow", { generatedAt: "2026-03-10T12:00:00.000Z" });
    assert.match(html, /<h2 id="flow">Cumulative flow<\/h2>/);
    for (const id of ["flow-14", "flow-30", "flow-90", "flow-365", "flow-all"]) {
      assert.match(html, new RegExp(`<input type="radio" name="flow-window" id="${id}"`));
      assert.match(html, new RegExp(`<figure class="flow ${id}">`));
    }
    assert.match(html, /id="flow-30" checked>/);
    assert.equal(html.match(/ checked>/g)?.length, 1);
    assert.equal(html.match(/<svg class="cfd"/g)?.length, 5);
    assert.match(html, /<title>2026-03-10: 1 arrived, 1 started, 0 done<\/title>/);
    assert.match(html, /Since Mar 1, 2026: 1 arrived, 1 started, 0 done\. At the end, 1 in progress and 0 not started\./);
    // Still self-contained and script-free
    assert.doesNotMatch(html, /src=|href=|<script/i);
  });

  it("forecasts the open tickets under the chart", async () => {
    const done = (await createTag(db, projectId, "state", "done")).id;
    const t = await createTicket(db, { projectId, title: "Done" });
    await assignTag(db, t.id, done);
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-09T08:00:00.000Z' WHERE ticket_id = ?", t.id);
    await createTicket(db, { projectId, title: "Open" });
    const html = await renderDashboard(db, projectId, "Flow", { generatedAt: "2026-03-10T12:00:00.000Z" });
    assert.match(html, /<p class="forecast"><strong>Forecast:<\/strong> At the pace of the last 90 days \(1 done\), 1 ticket will be done: 50% by 2026-/);
  });

  it("says there is nothing to chart without tickets", async () => {
    const html = await renderDashboard(db, projectId, "Flow");
    assert.match(html, /No tickets to chart yet\./);
    assert.doesNotMatch(html, /<svg/);
  });
});

describe("dashboard for live pages", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Live")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("names its project, limit and version for a page that refreshes it", async () => {
    const html = await renderDashboard(db, projectId, "A \"B\"", { limit: 3, version: "run.1.2026-03-10" });
    assert.match(html, /<meta name="rewelo-project" content="A &quot;B&quot;">/);
    assert.match(html, /<meta name="rewelo-limit" content="3">/);
    assert.match(html, /<meta name="rewelo-version" content="run\.1\.2026-03-10">/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(await renderDashboard(db, projectId, "Live"), /rewelo-limit|rewelo-version/);
  });

  it("reloads itself from its version file only when it is watched", async () => {
    const html = await renderDashboard(db, projectId, "Live", { version: "v1", reloadFrom: "dash.version.js" });
    assert.match(html, /<script>[\s\S]*script\.src = "dash\.version\.js" \+ "\?" \+ Date\.now\(\)[\s\S]*<\/script>/);
    assert.match(html, /window\.reweloDashboardVersion = /);
    // Every choice made on the page survives the reload, not only the window
    assert.match(html, /sessionStorage\.setItem\(key, JSON\.stringify\(choices\(\)\)\)/);
    // A file name can't end the script early
    const odd = await renderDashboard(db, projectId, "Live", { version: "v1", reloadFrom: "</script><b>.js" });
    assert.doesNotMatch(odd, /<\/script><b>/);
  });
});

describe("renderDashboardHtml", () => {
  // The page from a model alone, without a database
  const model: DashboardModel = {
    projectName: "A & B",
    rows: [],
    doneCount: 2,
    customWeights: true,
    distribution: [],
    health: { totalTickets: 2, doneTickets: 2, openTickets: 0, highPriorityCount: 0, lowPriorityCount: 0, highToLowRatio: null, totalBacklogCost: 0, staleDays: 90, staleTickets: [] },
    relations: [],
    flow: [],
  };

  it("escapes the project name and says why the ticket table is empty", () => {
    const html = renderDashboardHtml(model);
    assert.match(html, /<h1>A &amp; B<\/h1>/);
    assert.match(html, /No open tickets\./);
    assert.match(html, /2 done tickets are not listed\./);
    assert.match(html, /without the project's weights/);
  });
});
