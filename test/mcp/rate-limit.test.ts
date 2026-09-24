import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";

describe("MCP rate limiting and payload size", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup();
  });

  it("paces a burst of calls instead of rejecting it", async () => {
    const mcpServer = createMcpServer(":memory:", { maxRequestsPerSecond: 5 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await mcpServer.close();
    };

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => client.callTool({ name: "project_list", arguments: {} }))
    );
    assert.equal(results.filter((r) => r.isError).length, 0);
    // The last 3 had to wait for the first second to pass
    assert.ok(Date.now() - started >= 900);
  });

  it("doesn't run calls still waiting for their turn once the client is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-gone-"));
    const path = join(dir, "gone.db");
    const disconnected = new AbortController();
    const mcpServer = createMcpServer(path, { maxRequestsPerSecond: 2, signal: disconnected.signal });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup = async () => {
      await client.close();
      await mcpServer.close();
      rmSync(dir, { recursive: true, force: true });
    };

    const calls = Array.from({ length: 4 }, (_, i) =>
      client.callTool({ name: "project_create", arguments: { name: `P${i}` } })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    disconnected.abort();
    const results = await Promise.all(calls);
    assert.deepEqual(results.map((r) => Boolean(r.isError)), [false, false, true, true]);
    assert.match((results[3].content as any)[0].text, /client disconnected/);

    const db = await DB.open(path);
    try {
      assert.equal((await db.all("SELECT 1 FROM projects")).length, 2);
    } finally {
      await db.close();
    }
  });

  it("isn't thrown off by the system clock being set back", async () => {
    const mcpServer = createMcpServer(":memory:", { maxRequestsPerSecond: 2, maxRateLimitWaitMs: 0 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    const realNow = Date.now;
    cleanup = async () => {
      Date.now = realNow;
      await client.close();
      await mcpServer.close();
    };

    await client.callTool({ name: "project_list", arguments: {} });
    await client.callTool({ name: "project_list", arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const hourAgo = realNow() - 3_600_000;
    Date.now = () => hourAgo;
    const result = await client.callTool({ name: "project_list", arguments: {} });
    Date.now = realNow;
    assert.equal(result.isError, undefined);
  });

  it("rejects requests when rate limit is exceeded", async () => {
    // Very low limit for testing: 5 requests per second, no waiting
    const mcpServer = createMcpServer(":memory:", { maxRequestsPerSecond: 5, maxRateLimitWaitMs: 0 });
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
    assert.ok(errors.length > 0);
    const errorText = (errors[0].content as any)[0].text;
    assert.match(errorText, /Rate limit exceeded \(5 calls per second\)\. Try again in 1 s\./);
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
    assert.equal(result.isError, true);
    const text = (result.content as any)[0].text;
    assert.ok(text.includes("payload too large"));
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
    assert.equal(result.isError, true);
    const text = (result.content as any)[0].text;
    assert.ok(text.includes("payload too large"));
  });

  it("measures the payload limit in bytes, not characters", async () => {
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

    // 600k characters, but 1.2 MB of UTF-8
    const result = await client.callTool({
      name: "import_csv",
      arguments: { project: "Acme", csv: "title\n" + "é".repeat(600_000) },
    });
    assert.equal(result.isError, true);
    assert.ok(((result.content as any)[0].text).includes("payload too large"));
  });
});
