import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP simulate and explain_priority", () => {
  let client: Client;
  let close: () => Promise<void>;

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: r.isError === true, text, data: r.isError ? undefined : JSON.parse(text) };
  };

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
    // Priorities: A 3.67, B 2, C 0.63, D 1.5
    for (const [title, benefit, penalty, estimate, risk] of [["A", 8, 3, 2, 1], ["B", 5, 5, 3, 2], ["C", 3, 2, 5, 3], ["D", 2, 1, 1, 1]] as const) {
      await call("ticket_create", { project: "Acme", title, benefit, penalty, estimate, risk });
    }
  });

  afterEach(() => close());

  it("simulates a change without writing it", async () => {
    const before = (await call("ticket_list", { project: "Acme" })).data;
    const r = await call("simulate", { project: "Acme", changes: [{ title: "C", estimate: 1, risk: 1 }], top: 2 });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.data.top.map((t: { title: string }) => t.title), ["A", "C"]);
    assert.deepEqual(r.data.tickets.map((t: { title: string; rankChange: number }) => [t.title, t.rankChange]), [["C", 2], ["B", -1], ["D", -1]]);
    assert.deepEqual((await call("ticket_list", { project: "Acme" })).data, before);
  });

  it("ranks with the project's stored weights, as calc_priority does", async () => {
    await call("weight_set", { project: "Acme", w1: 0 });
    const r = await call("simulate", { project: "Acme" });
    const calc = (await call("calc_priority", { project: "Acme" })).data;
    assert.deepEqual(r.data.baselineWeights, { w1: 0, w2: 1.5, w3: 1.5, w4: 1.5 });
    assert.deepEqual(r.data.top.map((t: { title: string; priority: number }) => [t.title, t.priority]), calc.map((t: { title: string; weighted: number }) => [t.title, t.weighted]));
  });

  it("scopes the ranking to a tag", async () => {
    await call("tag_assign", { project: "Acme", tickets: ["C", "D"], prefix: "team", value: "core" });
    const r = await call("simulate", { project: "Acme", tag: "team:core" });
    assert.deepEqual(r.data.top.map((t: { title: string }) => t.title), ["D", "C"]);
  });

  it("rejects invalid scenarios", async () => {
    const unknown = await call("simulate", { project: "Acme", remove: ["Z"] });
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /Ticket "Z" not found/);
    const score = await call("simulate", { project: "Acme", changes: [{ title: "A", risk: 4 }] });
    assert.equal(score.isError, true);
    assert.match(score.text, /must be a Fibonacci value/);
    const title = await call("simulate", { project: "Acme", add: [{ title: "" }] });
    assert.equal(title.isError, true);
  });

  it("explains a priority and what it takes to reach the top 2", async () => {
    const r = await call("explain_priority", { project: "Acme", title: "C", top: 2 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.formula, "(1.5 × 3 + 1.5 × 2) / (1.5 × 5 + 1.5 × 3) = 7.5 / 12 = 0.63");
    assert.deepEqual([r.data.rank, r.data.of, r.data.target.priorityToBeat], [4, 4, 2]);
    assert.deepEqual(r.data.target.options.map((o: { dimension: string; to: number }) => [o.dimension, o.to]), [["benefit", 21], ["penalty", 21]]);
  });

  it("scopes simulate and explain_priority to several tags, as calc_priority does", async () => {
    await call("tag_assign", { project: "Acme", tickets: ["B", "C", "D"], prefix: "team", value: "core" });
    await call("tag_assign", { project: "Acme", tickets: ["C", "D"], prefix: "area", value: "api" });
    const sim = await call("simulate", { project: "Acme", tags: ["team:core", "area:api"] });
    assert.equal(sim.isError, false, sim.text);
    assert.deepEqual(sim.data.top.map((t: { title: string }) => t.title), ["D", "C"]);
    const both = await call("simulate", { project: "Acme", tag: "team:core", tags: ["area:api"] });
    assert.deepEqual(both.data.top.map((t: { title: string }) => t.title), ["D", "C"]);

    const r = await call("explain_priority", { project: "Acme", title: "C", tags: ["team:core", "area:api"] });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual([r.data.rank, r.data.of], [2, 2]);
    const lacks = await call("explain_priority", { project: "Acme", title: "B", tags: ["team:core", "area:api"] });
    assert.match(lacks.text, /Ticket "B" does not have the tags team:core, area:api/);
  });

  it("finds tickets by title as the other tools do: trimmed, spaces collapsed", async () => {
    await call("tag_assign", { project: "Acme", tickets: ["A", "B"], prefix: "team", value: "core" });
    const explained = await call("explain_priority", { project: "Acme", title: " B ", tags: ["team:core"] });
    assert.equal(explained.isError, false, explained.text);
    assert.equal(explained.data.title, "B");
    const sim = await call("simulate", { project: "Acme", remove: ["A "], changes: [{ title: " C", estimate: 1 }] });
    assert.equal(sim.isError, false, sim.text);
    assert.deepEqual(sim.data.tickets.filter((t: { change?: string }) => t.change).map((t: { title: string; change: string }) => [t.title, t.change]), [["C", "scores"], ["A", "removed"]]);
  });

  it("says when the ticket lacks the tag it is ranked within", async () => {
    await call("tag_assign", { project: "Acme", ticket: "D", prefix: "team", value: "core" });
    const r = await call("explain_priority", { project: "Acme", title: "C", tag: "team:core" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Ticket "C" does not have the tag team:core/);
    const missing = await call("explain_priority", { project: "Acme", title: "Z", tag: "team:core" });
    assert.match(missing.text, /Ticket "Z" not found/);
  });
});
