import { describe, it, expect, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "../../src/mcp/server.js";

type Message = { id?: number; result?: { content: Array<{ text: string }>; isError?: boolean } };

describe("MCP concurrency", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup();
  });

  it("handles concurrent first calls on a fresh server without losing writes", async () => {
    // A file DB, not :memory: — with :memory: every duplicate connection
    // gets its own private database and the race goes unnoticed.
    const dir = mkdtempSync(join(tmpdir(), "rw-"));
    const mcpServer = createMcpServer(join(dir, "c.db"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    cleanup = async () => {
      await clientTransport.close();
      await mcpServer.close();
      rmSync(dir, { recursive: true, force: true });
    };

    // Drive the protocol by hand: the SDK client spreads calls over several
    // ticks, but a stdio chunk can deliver many requests in the same tick.
    const responses = new Map<number, Message>();
    let notify = () => {};
    clientTransport.onmessage = (msg) => {
      const m = msg as Message;
      if (m.id !== undefined) responses.set(m.id, m);
      notify();
    };
    await clientTransport.start();
    const waitFor = (ids: number[]) =>
      new Promise<void>((resolve) => {
        notify = () => ids.every((id) => responses.has(id)) && resolve();
        notify();
      });

    await clientTransport.send({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    await waitFor([0]);
    await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const names = ["p1", "p2", "p3", "p4"];
    names.forEach((name, i) => {
      void clientTransport.send({
        jsonrpc: "2.0", id: i + 1, method: "tools/call",
        params: { name: "project_create", arguments: { name } },
      });
    });
    await waitFor(names.map((_, i) => i + 1));
    for (let i = 1; i <= names.length; i++) {
      expect(responses.get(i)!.result!.isError, responses.get(i)!.result!.content[0].text).toBeFalsy();
    }

    await clientTransport.send({
      jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "project_list", arguments: {} },
    });
    await waitFor([99]);
    const projects = JSON.parse(responses.get(99)!.result!.content[0].text);
    expect(projects.map((p: { name: string }) => p.name).sort()).toEqual(names);
  });
});
