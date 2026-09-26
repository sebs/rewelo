import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP apply_changes", () => {
  let client: Client;
  let close: () => Promise<void>;

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: r.isError === true, text, data: r.isError ? undefined : JSON.parse(text) };
  };

  // Everything a plan can change
  const state = async () => ({
    tickets: (await call("ticket_list", { project: "Acme" })).data,
    tags: (await call("tag_list", { project: "Acme" })).data,
    relations: (await call("relation_list_all", { project: "Acme" })).data,
    events: (await call("event_log", { project: "Acme" })).data,
  });

  beforeEach(async () => {
    const server = createMcpServer(":memory:");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
    await call("project_create", { name: "Acme" });
    // Priorities: A 3.67, B 2, C 0.63
    for (const [title, benefit, penalty, estimate, risk] of [["A", 8, 3, 2, 1], ["B", 5, 5, 3, 2], ["C", 3, 2, 5, 3]] as const) {
      await call("ticket_create", { project: "Acme", title, benefit, penalty, estimate, risk });
    }
    await call("tag_assign", { project: "Acme", ticket: "A", prefix: "state", value: "wip" });
  });

  afterEach(() => close());

  it("doesn't list a ticket as updated when the update changed nothing", async () => {
    const r = await call("apply_changes", { project: "Acme", operations: [{ op: "ticket_update", title: "A" }, { op: "ticket_update", title: "B", benefit: 5 }] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.data.operations.map((o: { changes: unknown[] }) => o.changes), [[], []]);
    assert.deepEqual(r.data.ranking.tickets, []);
  });

  it("doesn't list a ticket whose updates cancel out", async () => {
    const r = await call("apply_changes", { project: "Acme", dryRun: true, operations: [
      { op: "ticket_update", title: "C", benefit: 21 },
      { op: "ticket_update", title: "C", benefit: 3 },
      { op: "ticket_update", title: "B", description: "y" },
      { op: "ticket_update", title: "B", description: "  " },
    ] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.data.ranking.tickets, []);
  });

  it("ranks the open tickets as simulate does: closing a ticket takes it out, reopening puts it back", async () => {
    const closed = await call("apply_changes", { project: "Acme", dryRun: true, operations: [{ op: "tag_assign", ticket: "A", tag: "state:done" }] });
    assert.equal(closed.isError, false, closed.text);
    assert.equal(closed.data.ranking.total, 2);
    assert.deepEqual(closed.data.ranking.top.map((t: { title: string }) => t.title), ["B", "C"]);
    assert.deepEqual(closed.data.ranking.tickets.find((t: { title: string }) => t.title === "A"), {
      title: "A", baselineRank: 1, scenarioRank: null, rankChange: null, baselinePriority: 3.67, scenarioPriority: null, change: "done",
    });
    // The same as simulate's ranking, which leaves done tickets out
    await call("tag_assign", { project: "Acme", ticket: "A", prefix: "state", value: "done" });
    const simulated = await call("simulate", { project: "Acme" });
    assert.deepEqual(simulated.data.top.map((t: { title: string }) => t.title), ["B", "C"]);
    const reopened = await call("apply_changes", { project: "Acme", dryRun: true, operations: [{ op: "tag_remove", ticket: "A", tag: "state:done" }] });
    assert.equal(reopened.data.ranking.tickets.find((t: { title: string }) => t.title === "A").change, "reopened");
  });

  const plan = [
    { op: "ticket_create", title: "SSO", benefit: 21, penalty: 13, estimate: 2, risk: 1 },
    { op: "ticket_update", title: "C", newTitle: "C2", estimate: 1 },
    { op: "tag_assign", ticket: "A", tag: "state:done" },
    { op: "tag_assign", ticket: "SSO", tag: "team:core" },
    { op: "relation_create", source: "SSO", type: "blocks", target: "B" },
    { op: "ticket_delete", title: "B" },
  ];

  it("applies every operation and reports each one and the new ranking", async () => {
    const r = await call("apply_changes", { project: "Acme", operations: plan });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.applied, true);
    assert.deepEqual(r.data.operations, [
      { op: "ticket_create", title: "SSO" },
      { op: "ticket_update", title: "C2", changes: [{ field: "title", from: "C", to: "C2" }, { field: "estimate", from: 5, to: 1 }] },
      { op: "tag_assign", ticket: "A", tag: "state:done", status: "assigned", replaced: ["state:wip"], tagCreated: true },
      { op: "tag_assign", ticket: "SSO", tag: "team:core", status: "assigned", tagCreated: true },
      { op: "relation_create", source: "SSO", type: "blocks", target: "B" },
      { op: "ticket_delete", title: "B" },
    ]);
    // SSO (34/3 = 11.33) goes first; C, renamed C2, is followed by its id
    // and moves up to 2 (5/4 = 1.25): A, now done, leaves the ranking
    assert.deepEqual(
      r.data.ranking.tickets.map((t: { title: string; baselineRank: number | null; scenarioRank: number | null; change?: string }) =>
        [t.title, t.baselineRank, t.scenarioRank, t.change]),
      [["SSO", null, 1, "created"], ["C2", 3, 2, "updated"], ["A", 1, null, "done"], ["B", 2, null, "deleted"]]
    );
    const titles = (await call("ticket_list", { project: "Acme" })).data.items.map((t: { title: string }) => t.title).sort();
    assert.deepEqual(titles, ["A", "C2", "SSO"]);
  });

  it("changes nothing on a dry run, and reports the same", async () => {
    const before = await state();
    const dry = await call("apply_changes", { project: "Acme", operations: plan, dryRun: true });
    assert.equal(dry.isError, false, dry.text);
    assert.equal(dry.data.applied, false);
    assert.deepEqual(await state(), before);

    const real = await call("apply_changes", { project: "Acme", operations: plan });
    assert.deepEqual(real.data.operations, dry.data.operations);
    assert.deepEqual(real.data.ranking, dry.data.ranking);
  });

  it("changes nothing when one operation fails, and names it", async () => {
    const before = await state();
    const r = await call("apply_changes", {
      project: "Acme",
      operations: [plan[0], plan[1], { op: "tag_assign", ticket: "Nope", tag: "state:done" }],
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /^Operation 3 \(tag_assign\): Ticket "Nope" not found\. Nothing was changed\.$/);
    assert.deepEqual(await state(), before);
  });

  it("validates like the single tools", async () => {
    const title = await call("apply_changes", { project: "Acme", operations: [{ op: "ticket_create", title: "" }] });
    assert.match(title.text, /Operation 1 \(ticket_create\): /);
    const tag = await call("apply_changes", { project: "Acme", operations: [{ op: "tag_assign", ticket: "A", tag: "State" }] });
    assert.match(tag.text, /Operation 1 \(tag_assign\): Tag "State" must be in prefix:value format/);
    const score = await call("apply_changes", { project: "Acme", operations: [{ op: "ticket_update", title: "A", risk: 4 }] });
    assert.equal(score.isError, true);
    assert.match(score.text, /must be a Fibonacci value/);
    const unknown = await call("apply_changes", { project: "Acme", operations: [{ op: "project_delete", name: "Acme" }] });
    assert.equal(unknown.isError, true);
    const empty = await call("apply_changes", { project: "Acme", operations: [] });
    assert.equal(empty.isError, true);
  });

  it("leaves out a ticket created and deleted again", async () => {
    const r = await call("apply_changes", {
      project: "Acme",
      operations: [{ op: "ticket_create", title: "Tmp", benefit: 21 }, { op: "ticket_delete", title: "Tmp" }],
    });
    assert.deepEqual(r.data.ranking.tickets, []);
    assert.equal(r.data.ranking.moved, 0);
  });
});
