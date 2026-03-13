import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP rate limiting and payload size", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup();
  });

  it("rejects requests when rate limit is exceeded", async () => {
    // Very low limit for testing: 5 requests per second
    const mcpServer = createMcpServer(":memory:", { maxRequestsPerSecond: 5 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await mcpServer.close();
    };

    // Send requests rapidly — first 5 should succeed, 6th should be rate limited
    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(
        await client.callTool({ name: "project_list", arguments: {} })
      );
    }

    const errors = results.filter((r) => r.isError);
    expect(errors.length).toBeGreaterThan(0);
    const errorText = (errors[0].content as any)[0].text;
    expect(errorText).toContain("Rate limit exceeded");
  });

  it("rejects oversized import payload", async () => {
    const mcpServer = createMcpServer(":memory:");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await mcpServer.close();
    };

    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });

    // 2 MB CSV payload should be rejected
    const bigCsv = "title,benefit,penalty,estimate,risk\n" + "x".repeat(2_000_000);
    const result = await client.callTool({
      name: "import_csv",
      arguments: { project: "Acme", csv: bigCsv },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain("payload too large");
  });

  it("rejects oversized JSON import payload", async () => {
    const mcpServer = createMcpServer(":memory:");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await mcpServer.close();
    };

    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });

    const bigJson = JSON.stringify({ tickets: Array(50000).fill({ title: "x".repeat(100) }) });
    const result = await client.callTool({
      name: "import_json",
      arguments: { project: "Acme", json: bigJson },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as any)[0].text;
    expect(text).toContain("payload too large");
  });
});
