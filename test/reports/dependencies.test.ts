import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, type Ticket } from "../../src/tickets/repository.js";
import { createRelation } from "../../src/relations/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { byPriority, priority } from "../../src/calculations/priority.js";
import type { Fibonacci } from "../../src/domain/scores.js";
import { getDependencyGraph, MAX_GRAPH_NODES } from "../../src/reports/dependencies.js";
import { dependencyGraphSvg } from "../../src/reports/dependency-graph.js";
import { renderDashboard } from "../../src/reports/dashboard.js";

describe("dependency graph", () => {
  let db: DB;
  let projectId: number;
  const tickets: Ticket[] = [];

  const ticket = async (title: string, benefit: Fibonacci) => {
    const t = await createTicket(db, { projectId, title, benefit });
    tickets.push(t);
    return t;
  };
  const graph = () =>
    getDependencyGraph(db, projectId, [...tickets].sort(byPriority).map((t) => ({ id: t.id, title: t.title, priority: priority(t) })));

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Deps")).id;
    tickets.length = 0;
  });

  afterEach(async () => {
    await db.close();
  });

  it("lays tickets out after what they wait for, and counts what each holds up", async () => {
    const base = await ticket("Base", 2);
    const middle = await ticket("Middle", 3);
    const top = await ticket("Top", 21);
    const side = await ticket("Side", 5);
    await ticket("Alone", 13);
    await createRelation(db, projectId, base.id, middle.id, "blocks");
    await createRelation(db, projectId, middle.id, top.id, "blocks");
    // depends-on points the other way: Top waits for Side
    await createRelation(db, projectId, top.id, side.id, "depends-on");

    const g = await graph();
    const node = (title: string) => g.nodes.find((n) => n.title === title)!;
    assert.deepEqual(g.nodes.map((n) => n.title), ["Top", "Side", "Middle", "Base"]);
    assert.deepEqual([node("Base").layer, node("Middle").layer, node("Top").layer, node("Side").layer], [0, 1, 2, 0]);
    assert.deepEqual([node("Base").holdsUp, node("Middle").holdsUp, node("Side").holdsUp, node("Top").holdsUp], [2, 1, 1, 0]);
    assert.equal(node("Top").rank, 1);
    assert.equal(g.total, 4);
  });

  it("marks a ticket waiting for one with a lower priority, and not a tie", async () => {
    const low = await ticket("Low", 1);
    const high = await ticket("High", 21);
    const same = await ticket("Same", 1);
    await createRelation(db, projectId, low.id, high.id, "blocks");
    await createRelation(db, projectId, same.id, low.id, "blocks");
    const g = await graph();
    assert.deepEqual(
      g.edges.map((e) => [g.nodes.find((n) => n.id === e.to)!.title, e.inversion]).sort(),
      [["High", true], ["Low", false]]
    );
  });

  it("leaves out done tickets, as they block nothing", async () => {
    const done = await ticket("Done", 3);
    const open = await ticket("Open", 5);
    await createRelation(db, projectId, done.id, open.id, "blocks");
    await assignTag(db, done.id, (await createTag(db, projectId, "state", "done")).id);
    tickets.splice(tickets.indexOf(done), 1);
    assert.deepEqual((await graph()).nodes, []);
  });

  it("marks the tickets in progress", async () => {
    const a = await ticket("A", 3);
    const b = await ticket("B", 5);
    await createRelation(db, projectId, a.id, b.id, "blocks");
    await assignTag(db, a.id, (await createTag(db, projectId, "state", "wip")).id);
    const g = await graph();
    assert.deepEqual(g.nodes.map((n) => [n.title, n.inProgress]), [["B", false], ["A", true]]);
    const svg = dependencyGraphSvg(g);
    assert.match(svg, /<g class="node wip"/);
    assert.match(svg, /<title>B waits for A, which has a lower priority<\/title>/);
    assert.doesNotMatch(svg, /NaN|undefined/);
  });

  it("keeps the highest-ranked tickets of a large graph, and says how many there are", async () => {
    const hub = await ticket("Hub", 21);
    for (let i = 0; i < MAX_GRAPH_NODES + 5; i++) {
      const t = await ticket(`Leaf ${i}`, 1);
      await createRelation(db, projectId, t.id, hub.id, "blocks");
    }
    const g = await graph();
    assert.equal(g.nodes.length, MAX_GRAPH_NODES);
    assert.equal(g.total, MAX_GRAPH_NODES + 6);
    assert.equal(g.nodes[0].title, "Hub");
  });

  it("shows the graph and the inversions on the dashboard", async () => {
    const low = await ticket("Low <b>", 1);
    const high = await ticket("High", 21);
    await createRelation(db, projectId, low.id, high.id, "blocks");
    const html = await renderDashboard(db, projectId, "Deps");
    assert.match(html, /<h2 id="dependencies">Dependencies<\/h2>/);
    assert.match(html, /<svg class="deps"/);
    assert.match(html, /<li><strong>High<\/strong> \(#1, 11\.00\) waits for <strong>Low &lt;b&gt;<\/strong> \(#2, 1\.00\)<\/li>/);
    assert.doesNotMatch(html, /src=|href=|<script/i);
  });

  it("says when no open ticket blocks another", async () => {
    await ticket("Alone", 1);
    assert.match(await renderDashboard(db, projectId, "Deps"), /No open ticket blocks another\./);
  });
});
