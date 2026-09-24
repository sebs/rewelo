import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP tag rename tool", () => {
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
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Acme", title: "Login page" },
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("renames a tag and carries over assignments", async () => {
    // Create and assign original tag
    await client.callTool({
      name: "tag_create",
      arguments: { project: "Acme", prefix: "feature", value: "login" },
    });
    await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", ticket: "Login page", prefix: "feature", value: "login" },
    });

    // Rename the tag
    const renameResult = await client.callTool({
      name: "tag_rename",
      arguments: { project: "Acme", prefix: "feature", oldValue: "login", newValue: "auth" },
    });
    assert.ok(!renameResult.isError);
    const renamed = JSON.parse((renameResult.content as any)[0].text);
    assert.equal(renamed.value, "auth");

    // Old tag should not exist, ticket should be findable via new tag
    const listResult = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", tag: "feature:auth" },
    });
    const tickets = JSON.parse((listResult.content as any)[0].text);
    assert.equal(tickets.items.length, 1);
    assert.equal(tickets.items[0].title, "Login page");

    // Old tag should return no tickets
    const oldResult = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", tag: "feature:login" },
    });
    const oldTickets = JSON.parse((oldResult.content as any)[0].text);
    assert.equal(oldTickets.items.length, 0);
  });

  it("returns error for non-existent tag", async () => {
    const result = await client.callTool({
      name: "tag_rename",
      arguments: { project: "Acme", prefix: "state", oldValue: "nope", newValue: "yes" },
    });
    assert.equal(result.isError, true);
  });

  it("validates new tag value format", async () => {
    await client.callTool({
      name: "tag_create",
      arguments: { project: "Acme", prefix: "state", value: "open" },
    });
    const result = await client.callTool({
      name: "tag_rename",
      arguments: { project: "Acme", prefix: "state", oldValue: "open", newValue: "INVALID CHARS!" },
    });
    assert.equal(result.isError, true);
  });
});
