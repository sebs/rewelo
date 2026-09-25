import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP tool annotations", () => {
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

  const byHint = async (hint: "readOnlyHint" | "destructiveHint" | "idempotentHint") =>
    (await client.listTools()).tools.filter((t) => t.annotations?.[hint] === true).map((t) => t.name).sort();

  it("annotates every tool, and none reaches outside the database", async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      assert.equal(typeof t.annotations?.readOnlyHint, "boolean", t.name);
      assert.equal(t.annotations?.openWorldHint, false, t.name);
      if (!t.annotations?.readOnlyHint) assert.equal(typeof t.annotations?.destructiveHint, "boolean", t.name);
    }
  });

  it("marks the tools that only read as read-only", async () => {
    assert.deepEqual(await byHint("readOnlyHint"), [
      "calc_priority", "calc_weights", "event_log", "export_csv", "export_json",
      "project_diff", "project_history", "project_list",
      "relation_list", "relation_list_all",
      "report_dashboard", "report_distribution", "report_group", "report_health", "report_summary", "report_times",
      "server_version", "tag_list", "ticket_history", "ticket_list", "weight_get",
    ]);
  });

  it("marks deletes and overwrites as destructive, and the adding tools as not", async () => {
    assert.deepEqual(await byHint("destructiveHint"), [
      "import_json", "project_delete", "relation_remove", "tag_assign", "tag_delete", "tag_remove", "tag_rename",
      "ticket_delete", "ticket_update", "ticket_upsert", "weight_reset", "weight_set",
    ]);
    const { tools } = await client.listTools();
    const additive = tools.filter((t) => t.annotations?.destructiveHint === false).map((t) => t.name).sort();
    assert.deepEqual(additive, ["import_csv", "project_create", "relation_create", "tag_create", "ticket_create"]);
  });

  it("marks the tools that are safe to repeat as idempotent", async () => {
    assert.deepEqual(await byHint("idempotentHint"), [
      "project_delete", "relation_remove", "tag_assign", "tag_delete", "tag_remove",
      "ticket_delete", "ticket_upsert", "weight_reset", "weight_set",
    ]);
  });
});
