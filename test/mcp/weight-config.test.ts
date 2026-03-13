import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP weight configuration tools", () => {
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

    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("weight_get returns defaults", async () => {
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "Acme" },
    });
    const config = JSON.parse((result.content as any)[0].text);
    expect(config.w1).toBe(1.5);
    expect(config.w2).toBe(1.5);
    expect(config.w3).toBe(1.5);
    expect(config.w4).toBe(1.5);
  });

  it("weight_set persists custom weights", async () => {
    await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w1: 3.0, w2: 1.0, w3: 1.5, w4: 2.0 },
    });
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "Acme" },
    });
    const config = JSON.parse((result.content as any)[0].text);
    expect(config.w1).toBe(3.0);
    expect(config.w2).toBe(1.0);
    expect(config.w3).toBe(1.5);
    expect(config.w4).toBe(2.0);
  });

  it("weight_set only changes provided weights", async () => {
    await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w1: 3.0 },
    });
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "Acme" },
    });
    const config = JSON.parse((result.content as any)[0].text);
    expect(config.w1).toBe(3.0);
    expect(config.w2).toBe(1.5);
  });

  it("weight_set rejects negative weights", async () => {
    const result = await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w1: -1.0 },
    });
    expect(result.isError).toBe(true);
  });

  it("weight_set allows zero weight", async () => {
    const result = await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w2: 0 },
    });
    expect(result.isError).toBeFalsy();
    const get = await client.callTool({
      name: "weight_get",
      arguments: { project: "Acme" },
    });
    const config = JSON.parse((get.content as any)[0].text);
    expect(config.w2).toBe(0);
  });

  it("weight_reset restores defaults", async () => {
    await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w1: 5.0, w2: 0, w3: 10, w4: 0.1 },
    });
    await client.callTool({
      name: "weight_reset",
      arguments: { project: "Acme" },
    });
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "Acme" },
    });
    const config = JSON.parse((result.content as any)[0].text);
    expect(config.w1).toBe(1.5);
    expect(config.w2).toBe(1.5);
    expect(config.w3).toBe(1.5);
    expect(config.w4).toBe(1.5);
  });

  it("weights are scoped per project", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Globex" } });
    await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w1: 5.0 },
    });
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "Globex" },
    });
    const config = JSON.parse((result.content as any)[0].text);
    expect(config.w1).toBe(1.5);
  });

  it("weight_get returns error for non-existent project", async () => {
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "NoSuchProject" },
    });
    expect(result.isError).toBe(true);
  });
});
