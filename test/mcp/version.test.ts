import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";
import { VERSION } from "../../src/version.generated.js";

describe("MCP version", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const mcpServer = createMcpServer(":memory:");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await mcpServer.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("reports version in server info", async () => {
    const info = client.getServerVersion();
    assert.notEqual(info, undefined);
    assert.equal(info!.version, VERSION);
    assert.equal(info!.name, "rewelo");
  });

  it("exposes server_version tool", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("server_version"));
  });

  it("returns version via server_version tool", async () => {
    const result = await client.callTool({ name: "server_version", arguments: {} });
    assert.ok(!result.isError);
    const text = (result.content as any)[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.version, VERSION);
  });
});
