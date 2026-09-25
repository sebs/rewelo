import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

const DOCUMENTS = ["export_csv", "export_json", "report_dashboard"];

describe("MCP structured output", () => {
  let client: Client;
  let close: () => Promise<void>;

  before(async () => {
    const server = createMcpServer(":memory:");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  after(() => close());

  it("advertises an outputSchema for every tool but the ones returning documents", async () => {
    const { tools } = await client.listTools();
    const without = tools.filter((t) => t.outputSchema === undefined).map((t) => t.name).sort();
    assert.deepEqual(without, DOCUMENTS);
    for (const t of tools.filter((t) => t.outputSchema)) assert.equal(t.outputSchema!.type, "object", t.name);
  });

  it("returns every result as structuredContent matching its JSON text", async () => {
    // Every tool with an outputSchema, in an order that gives each something to return
    const calls: [string, Record<string, unknown>][] = [
      ["server_version", {}],
      ["project_create", { name: "Acme" }],
      ["project_list", {}],
      ["ticket_create", { project: "Acme", title: "A", benefit: 8, penalty: 3, estimate: 2, risk: 1 }],
      ["ticket_upsert", { project: "Acme", title: "B", benefit: 2 }],
      ["ticket_update", { project: "Acme", title: "B", description: "Second" }],
      ["tag_create", { project: "Acme", prefix: "team", value: "core" }],
      ["tag_assign", { project: "Acme", tickets: ["A", "B"], prefix: "state", value: "wip" }],
      ["tag_assign", { project: "Acme", ticket: "A", prefix: "state", value: "done" }],
      ["tag_remove", { project: "Acme", ticket: "B", prefix: "state", value: "wip" }],
      ["tag_rename", { project: "Acme", prefix: "team", oldValue: "core", newValue: "platform" }],
      ["tag_list", { project: "Acme" }],
      ["relation_create", { project: "Acme", source: "A", type: "blocks", target: "B" }],
      ["relation_list", { project: "Acme", ticket: "A" }],
      ["relation_list_all", { project: "Acme" }],
      ["weight_set", { project: "Acme", w1: 2 }],
      ["weight_get", { project: "Acme" }],
      ["calc_priority", { project: "Acme" }],
      ["calc_weights", { project: "Acme" }],
      ["simulate", { project: "Acme", changes: [{ title: "B", estimate: 1 }], add: [{ title: "New", benefit: 21 }] }],
      ["simulate", { project: "Acme", remove: ["B"] }],
      ["explain_priority", { project: "Acme", title: "B" }],
      ["suggest_scores", { project: "Acme", title: "A new B", description: "Like B" }],
      ["weight_reset", { project: "Acme" }],
      ["ticket_list", { project: "Acme" }],
      ["ticket_history", { project: "Acme", title: "B" }],
      ["project_history", { project: "Acme" }],
      ["report_summary", { project: "Acme" }],
      ["report_times", { project: "Acme" }],
      ["report_health", { project: "Acme" }],
      ["report_distribution", { project: "Acme" }],
      ["report_group", { project: "Acme", prefix: "state" }],
      ["event_log", { project: "Acme" }],
      ["project_diff", { project: "Acme", since: "2000-01-01T00:00:00Z" }],
      ["apply_changes", { project: "Acme", dryRun: true, operations: [
        { op: "ticket_create", title: "D", benefit: 21 },
        { op: "ticket_update", title: "B", estimate: 5 },
        { op: "tag_assign", ticket: "D", tag: "state:wip" },
        { op: "tag_remove", ticket: "A", tag: "state:done" },
        { op: "relation_create", source: "D", type: "blocks", target: "A" },
        { op: "relation_remove", source: "A", type: "blocks", target: "B" },
        { op: "ticket_delete", title: "B" },
      ] }],
      ["relation_remove", { project: "Acme", source: "A", type: "blocks", target: "B" }],
      ["tag_delete", { project: "Acme", prefix: "team", value: "platform" }],
      ["import_csv", { project: "Acme", csv: "title\nC" }],
      ["import_json", { project: "Other", json: JSON.stringify({ tickets: [{ title: "X" }], weights: { w1: 1, w2: 1, w3: 1, w4: 1 } }) }],
      ["ticket_delete", { project: "Acme", title: "C" }],
      ["project_delete", { name: "Other" }],
    ];
    const { tools } = await client.listTools();
    const structured = tools.filter((t) => t.outputSchema).map((t) => t.name);
    assert.deepEqual([...new Set(calls.map(([name]) => name))].sort(), structured.sort());

    for (const [name, args] of calls) {
      // The client checks structuredContent against the outputSchema
      const r = await client.callTool({ name, arguments: args }).catch((err: Error) => assert.fail(`${name}: ${err.message}`));
      const text = (r.content as { text: string }[])[0].text;
      assert.ok(!r.isError, `${name}: ${text}`);
      const data = JSON.parse(text);
      // As over stdio: the in-memory transport passes objects unserialised
      const wire = JSON.parse(JSON.stringify(r.structuredContent));
      // The 2025 protocol wraps an array as {result: [...]}
      assert.deepEqual(wire, Array.isArray(data) ? { result: data } : data, name);
    }
  });

  it("leaves documents as text", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Docs" } });
    for (const name of DOCUMENTS) {
      const r = await client.callTool({ name, arguments: { project: "Docs" } });
      assert.equal(r.structuredContent, undefined, name);
    }
  });
});
