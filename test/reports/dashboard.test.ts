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
    // The page's tables, not the ticket browser's dialog
    assert.equal(html.split("<dialog")[0].match(/<td class="n strong">/g)?.length, 2);
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
      assert.match(html, new RegExp(`<figure class="flow ${id} measure-count">`));
    }
    assert.match(html, /id="flow-30" checked>/);
    assert.match(html, /id="measure-count" checked>/);
    // The page's own, not the ticket browser's
    assert.equal(html.split("<dialog")[0].match(/ checked>/g)?.length, 2);
    // Five windows in seven measures
    assert.equal(html.match(/<svg class="cfd"/g)?.length, 35);
    assert.match(html, /<title>2026-03-10: 1 arrived, 1 started, 0 done<\/title>/);
    assert.match(html, /Since Mar 1, 2026: 1 arrived, 1 started, 0 done\. At the end, 1 in progress and 0 not started\./);
    // Still self-contained and script-free
    assert.doesNotMatch(html, /src=|href=|<script/i);
  });

  it("charts the sum of a score on the y axis when the measure is switched", async () => {
    const wip = (await createTag(db, projectId, "state", "wip")).id;
    const a = await createTicket(db, { projectId, title: "A", benefit: 8, penalty: 5, estimate: 3, risk: 2 });
    await createTicket(db, { projectId, title: "B", benefit: 13, penalty: 1, estimate: 1, risk: 1 });
    await assignTag(db, a.id, wip);
    await db.run("UPDATE tickets SET created_at = '2026-03-01T08:00:00.000Z'");
    await db.run("UPDATE ticket_tag_changes SET changed_at = '2026-03-04T08:00:00.000Z'");

    const html = await renderDashboard(db, projectId, "Flow", { generatedAt: "2026-03-10T12:00:00.000Z" });
    for (const [id, label] of [["count", "Count"], ["benefit", '<abbr title="Benefit">B</abbr>'], ["penalty", '<abbr title="Penalty">P</abbr>'], ["estimate", '<abbr title="Estimate">E</abbr>'], ["risk", '<abbr title="Risk">R</abbr>'], ["value", "Value"], ["cost", "Cost"]]) {
      assert.ok(html.includes(`<input type="radio" name="flow-measure" id="measure-${id}"`), id);
      assert.ok(html.includes(`<label for="measure-${id}">${label}</label>`), id);
    }
    // Value is benefit + penalty: 13 + 14 arrived, 13 started
    assert.match(html, /<figure class="flow flow-all measure-value">/);
    assert.match(html, /<title>2026-03-10, by value: 27 arrived, 13 started, 0 done<\/title>/);
    assert.match(html, /Since Mar 1, 2026, by cost: 7 arrived, 5 started, 0 done\. At the end, 5 in progress and 2 not started\./);
    assert.match(html, /\.flow-card:has\(#flow-90:checked\):has\(#measure-risk:checked\) \.flow-90\.measure-risk \{ display: block; \}/);
    assert.doesNotMatch(html, /<script/);
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

describe("dashboard ticket browser", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Browse")).id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("opens every ticket, done ones too, in a dialog without a script", async () => {
    const done = await createTicket(db, { projectId, title: "Shipped", benefit: 21 });
    await createTicket(db, { projectId, title: "Waiting" });
    await assignTag(db, done.id, (await createTag(db, projectId, "state", "done")).id);

    const html = await renderDashboard(db, projectId, "Browse");
    assert.match(html, /<button type="button" class="open-browser" commandfor="ticket-browser" command="show-modal">Browse all tickets<\/button>/);
    assert.match(html, /<dialog id="ticket-browser" class="browser" closedby="any" aria-labelledby="browser-title">/);
    assert.match(html, /<button type="button" class="link" commandfor="ticket-\d+" command="show-modal">Shipped<\/button><\/td><td><span class="badge">done<\/span><\/td>/);
    assert.match(html, /command="show-modal">Waiting<\/button>/);
    assert.doesNotMatch(html, /<script|src=|href=/i);
  });

  it("filters by the state tags the tickets hold, with a count each", async () => {
    const wip = (await createTag(db, projectId, "state", "wip")).id;
    const done = (await createTag(db, projectId, "state", "done")).id;
    for (const [title, tag] of [["A", wip], ["B", done], ["C", done], ["D", undefined]] as const) {
      const t = await createTicket(db, { projectId, title });
      if (tag) await assignTag(db, t.id, tag);
    }
    const html = await renderDashboard(db, projectId, "Browse");
    const labels = [...html.matchAll(/<label for="browser-state-(\d)">([^<]*) <span class="count">(\d+)<\/span><\/label>/g)].map((m) => `${m[2]} ${m[3]}`);
    assert.deepEqual(labels, ["All 4", "done 2", "wip 1", "No state 1"]);
    assert.match(html, /<input type="radio" name="browser-state" id="browser-state-0" checked>/);
    assert.match(html, /\.browser:has\(#browser-state-1:checked\) \.list-1 \{ display: block; \}/);
    // A ticket is listed under All and its state, its details once
    assert.equal(html.match(/command="show-modal">B<\/button>/g)?.length, 2);
    assert.equal(html.match(/<dialog id="ticket-\d+"/g)?.length, 4);
  });

  it("has no state filter but All when no ticket has a state", async () => {
    await createTicket(db, { projectId, title: "A" });
    const html = await renderDashboard(db, projectId, "Browse");
    assert.equal(html.match(/name="browser-state"/g)?.length, 1);
  });

  it("pages the tickets, twenty at a time", async () => {
    for (let i = 0; i < 45; i++) await createTicket(db, { projectId, title: `T${i}` });
    const html = await renderDashboard(db, projectId, "Browse");
    assert.equal(html.match(/<tbody class="page page-\d">/g)?.length, 3);
    assert.equal(html.match(/name="browser-page-0"/g)?.length, 3);
    assert.match(html, /<input type="radio" name="browser-page-0" id="browser-page-0-1" value="1" checked>/);
    assert.match(html, /\.browser-list:has\(\.pager input\[value="3"\]:checked\) \.page-3 \{ display: table-row-group; \}/);
    const third = html.split(`<tbody class="page page-3">`)[1].split("</tbody>")[0];
    assert.equal(third.match(/<tr>/g)?.length, 5);
  });

  it("shows a ticket's scores, description, tags and relations in its details", async () => {
    const a = await createTicket(db, { projectId, title: "Login", description: "Line one\n<b>two</b>", benefit: 8, penalty: 5, estimate: 3, risk: 2 });
    const b = await createTicket(db, { projectId, title: "Signup" });
    const c = await createTicket(db, { projectId, title: "Old" });
    await createRelation(db, projectId, b.id, a.id, "blocks");
    await createRelation(db, projectId, a.id, c.id, "relates-to");
    await assignTag(db, c.id, (await createTag(db, projectId, "state", "done")).id);
    await assignTag(db, a.id, (await createTag(db, projectId, "team", "web")).id);

    const html = await renderDashboard(db, projectId, "Browse");
    const detail = html.split(`<dialog id="ticket-${a.id}"`)[1].split("</dialog>")[0];
    assert.match(detail, /<h2 id="ticket-\d+-title">Login<\/h2>/);
    assert.match(detail, /<dt>Value<\/dt><dd>13<\/dd>/);
    assert.match(detail, /<dt>Priority<\/dt><dd>2\.60<\/dd>/);
    assert.match(detail, /<p class="desc">Line one\n&lt;b&gt;two&lt;\/b&gt;<\/p>/);
    assert.match(detail, /<li class="badge">team:web<\/li>/);
    // Read from this ticket: Signup blocks it
    assert.match(detail, /<li><span class="muted">is-blocked-by<\/span> Signup<\/li>/);
    assert.match(detail, /<li><span class="muted">relates-to<\/span> Old <span class="badge">done<\/span><\/li>/);
    assert.match(detail, /commandfor="ticket-\d+" command="close"/);
    const other = html.split(`<dialog id="ticket-${b.id}"`)[1].split("</dialog>")[0];
    assert.match(other, /No description\./);
    assert.match(other, /No tags\./);
  });

  it("lists as many tickets as the limit, and says how many are left out", async () => {
    for (let i = 0; i < 4; i++) await createTicket(db, { projectId, title: `T${i}` });
    const html = await renderDashboard(db, projectId, "Browse", { limit: 2 });
    const browser = html.split(`<dialog id="ticket-browser"`)[1].split("</dialog>")[0];
    assert.match(browser, /Showing 2 of 4 tickets/);
    assert.equal(html.match(/<dialog id="ticket-\d+"/g)?.length, 2);
  });

  it("cuts a long description in the details", async () => {
    await createTicket(db, { projectId, title: "Long", description: "x".repeat(2500) });
    const html = await renderDashboard(db, projectId, "Browse");
    assert.match(html, new RegExp(`<p class="desc">x{2000}…</p><p class="meta">The first 2,000 characters;`));
  });

  it("offers no browser without tickets", async () => {
    const html = await renderDashboard(db, projectId, "Browse");
    assert.doesNotMatch(html, /open-browser"|<dialog/);
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
    // Every choice made on the page survives the reload, not only the window, and the dialogs open
    assert.match(html, /sessionStorage\.setItem\(key, JSON\.stringify\(choices\(\)\)\)/);
    assert.match(html, /sessionStorage\.setItem\(dialogsKey, /);
    assert.match(html, /dialog\.showModal\(\)/);
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
