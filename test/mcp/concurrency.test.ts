import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
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
      assert.ok(!(responses.get(i)!.result!.isError), responses.get(i)!.result!.content[0].text);
    }

    await clientTransport.send({
      jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "project_list", arguments: {} },
    });
    await waitFor([99]);
    const projects = JSON.parse(responses.get(99)!.result!.content[0].text);
    assert.deepEqual(projects.map((p: { name: string }) => p.name).sort(), names);
  });

  it("keeps a concurrent call's write when a failing import rolls back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-"));
    const mcpServer = createMcpServer(join(dir, "c.db"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    cleanup = async () => {
      await clientTransport.close();
      await mcpServer.close();
      rmSync(dir, { recursive: true, force: true });
    };

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
    const call = (id: number, name: string, args: Record<string, unknown>) =>
      clientTransport.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

    await clientTransport.send({
      jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    await waitFor([0]);
    await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await call(1, "project_create", { name: "p" });
    await waitFor([1]);

    // Same tick: an import that fails on its last row, and an unrelated create.
    void call(2, "import_csv", { project: "p", csv: "title\nA\nB\nA\n" });
    void call(3, "ticket_create", { project: "p", title: "Other" });
    await waitFor([2, 3]);
    assert.equal(responses.get(2)!.result!.isError, true);
    assert.ok(!(responses.get(3)!.result!.isError));

    await call(4, "ticket_list", { project: "p" });
    await waitFor([4]);
    const list = JSON.parse(responses.get(4)!.result!.content[0].text);
    assert.deepEqual(list.items.map((t: { title: string }) => t.title), ["Other"]);
  });

  // Another process holding the write lock (e.g. a large import), for `ms`
  function holdWriteLock(path: string, ms: number): Promise<{ exited: Promise<unknown> }> {
    const script = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(path)});
      db.exec("BEGIN IMMEDIATE");
      process.stdout.write("locked\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
      db.exec("COMMIT");
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    return new Promise((resolve) => child.stdout!.once("data", () => resolve({ exited })));
  }

  it("answers other calls while a write waits for another process's lock, and stops waiting when cancelled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-"));
    const path = join(dir, "l.db");
    const mcpServer = createMcpServer(path);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(clientTransport);
    let exited: Promise<unknown> = Promise.resolve();
    cleanup = async () => {
      await exited;
      await client.close();
      await mcpServer.close();
      rmSync(dir, { recursive: true, force: true });
    };
    await client.callTool({ name: "project_create", arguments: { name: "p" } });

    ({ exited } = await holdWriteLock(path, 1500));
    const write = client.callTool({ name: "ticket_create", arguments: { project: "p", title: "Waits" } });
    const cancelled = new AbortController();
    const dropped = client.callTool({ name: "ticket_create", arguments: { project: "p", title: "Dropped" } }, { signal: cancelled.signal });
    const started = Date.now();
    const read = await client.callTool({ name: "project_list", arguments: {} });
    assert.ok(Date.now() - started < 1000, `the read waited ${Date.now() - started} ms`);
    assert.ok(!read.isError);
    cancelled.abort();
    await assert.rejects(dropped);

    const written = await write;
    assert.ok(!written.isError, JSON.stringify(written.content));
    const list = await client.callTool({ name: "ticket_list", arguments: { project: "p" } });
    const titles = JSON.parse((list.content as Array<{ text: string }>)[0].text).items.map((t: { title: string }) => t.title);
    assert.deepEqual(titles, ["Waits"]);
  });
});
