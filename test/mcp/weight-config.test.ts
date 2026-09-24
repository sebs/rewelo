import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
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
    assert.equal(config.w1, 1.5);
    assert.equal(config.w2, 1.5);
    assert.equal(config.w3, 1.5);
    assert.equal(config.w4, 1.5);
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
    assert.equal(config.w1, 3.0);
    assert.equal(config.w2, 1.0);
    assert.equal(config.w3, 1.5);
    assert.equal(config.w4, 2.0);
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
    assert.equal(config.w1, 3.0);
    assert.equal(config.w2, 1.5);
  });

  it("weight_set rejects negative weights", async () => {
    const result = await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w1: -1.0 },
    });
    assert.equal(result.isError, true);
  });

  it("weight_set allows zero weight", async () => {
    const result = await client.callTool({
      name: "weight_set",
      arguments: { project: "Acme", w2: 0 },
    });
    assert.ok(!result.isError);
    const get = await client.callTool({
      name: "weight_get",
      arguments: { project: "Acme" },
    });
    const config = JSON.parse((get.content as any)[0].text);
    assert.equal(config.w2, 0);
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
    assert.equal(config.w1, 1.5);
    assert.equal(config.w2, 1.5);
    assert.equal(config.w3, 1.5);
    assert.equal(config.w4, 1.5);
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
    assert.equal(config.w1, 1.5);
  });

  it("weight_get returns error for non-existent project", async () => {
    const result = await client.callTool({
      name: "weight_get",
      arguments: { project: "NoSuchProject" },
    });
    assert.equal(result.isError, true);
  });

  it("calc_priority validates inline weights like weight_set", async () => {
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "A" } });
    const call = (args: Record<string, number>) =>
      client.callTool({ name: "calc_priority", arguments: { project: "Acme", ...args } });

    const negative = await call({ w1: -5 });
    assert.equal(negative.isError, true);
    assert.ok(((negative.content as any)[0].text).includes("Weight w1 must be a non-negative number"));

    const huge = await call({ w1: 1e308 });
    assert.equal(huge.isError, true);
    assert.ok(((huge.content as any)[0].text).includes("must not exceed 100"));

    assert.ok(!((await call({ w1: 3 })).isError));
  });
});
