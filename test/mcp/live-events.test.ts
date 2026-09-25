import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";
import { DB } from "../../src/db/connection.js";
import { createTicket } from "../../src/tickets/repository.js";

const POLL_MS = 20;
// Long enough for several checks: nothing arriving by then won't arrive
const settle = () => new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));

// Waits for what should arrive, however busy the machine running the tests
async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  // And a little longer, so a message too many shows too
  await settle();
}

describe("MCP live events", () => {
  let dir: string;
  let path: string;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-live-"));
    path = join(dir, "live.db");
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  async function connect(channel = false) {
    const server = createMcpServer(path, { channel, pollIntervalMs: POLL_MS });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const updated: string[] = [];
    const channelMessages: { content: string; meta: Record<string, string> }[] = [];
    client.setNotificationHandler("notifications/resources/updated", async (n) => {
      updated.push(n.params.uri);
    });
    client.fallbackNotificationHandler = async (n) => {
      if (n.method === "notifications/claude/channel") channelMessages.push(n.params as never);
    };
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    return { client, updated, channelMessages };
  }

  // A write the server doesn't see: another process, such as the rw CLI
  async function writeElsewhere(title: string) {
    const db = await DB.open(path);
    try {
      await createTicket(db, { projectId: 1, title, benefit: 13, penalty: 5, estimate: 3, risk: 2 });
    } finally {
      await db.close();
    }
  }

  it("tells subscribers when a tool or another process changes the database", async () => {
    const { client, updated } = await connect();
    assert.deepEqual((client.getServerCapabilities()?.resources as { subscribe?: boolean }).subscribe, true);
    await client.subscribeResource({ uri: "rewelo://Acme/backlog" });
    await settle();
    assert.deepEqual(updated, []);

    await client.callTool({ name: "ticket_list", arguments: { project: "Acme" } });
    await settle();
    assert.deepEqual(updated, [], "a read changes nothing");

    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "Mine", benefit: 1, penalty: 1, estimate: 1, risk: 1 } });
    await until(() => updated.length >= 1);
    assert.deepEqual(updated, ["rewelo://Acme/backlog"]);

    await writeElsewhere("Theirs");
    await until(() => updated.length >= 2);
    assert.deepEqual(updated, ["rewelo://Acme/backlog", "rewelo://Acme/backlog"]);

    await client.unsubscribeResource({ uri: "rewelo://Acme/backlog" });
    await writeElsewhere("Later");
    await settle();
    assert.equal(updated.length, 2);
  });

  it("refuses subscriptions to other URIs", async () => {
    const { client } = await connect();
    await assert.rejects(client.subscribeResource({ uri: "file:///etc/passwd" }), /rewelo's resources start with rewelo:\/\//);
  });

  it("pushes changes made elsewhere into a channel, but not its own", async () => {
    const { client, channelMessages } = await connect(true);
    assert.deepEqual(client.getServerCapabilities()?.experimental, { "claude/channel": {} });
    assert.match(client.getInstructions() ?? "", /arrive as <channel source="rewelo"> messages/);
    await settle();

    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "Mine", benefit: 1, penalty: 1, estimate: 1, risk: 1 } });
    await writeElsewhere("Login page");
    await until(() => channelMessages.length >= 1);

    assert.equal(channelMessages.length, 1, JSON.stringify(channelMessages));
    assert.equal(channelMessages[0].content, 'New ticket "Login page" in Acme (benefit 13, penalty 5, estimate 3, risk 2).');
    assert.deepEqual({ ...channelMessages[0].meta, sequence: undefined }, { project: "Acme", event: "ticket_created", ticket: "Login page", sequence: undefined });
  });

  it("has no channel unless asked for", async () => {
    const { client, channelMessages } = await connect();
    assert.equal(client.getServerCapabilities()?.experimental, undefined);
    await writeElsewhere("Login page");
    await settle();
    assert.deepEqual(channelMessages, []);
  });
});
