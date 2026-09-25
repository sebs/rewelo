import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";
import { DB } from "../../src/db/connection.js";

const TICKETS = 12_000;

describe("MCP links to documents over 5 MB", () => {
  let client: Client;
  let close: () => Promise<void>;

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-links-"));
    const path = join(dir, "big.db");
    const server = createMcpServer(path);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    };
    await client.callTool({ name: "project_create", arguments: { name: "Big Project" } });
    const db = await DB.open(path);
    await db.transaction(async () => {
      for (let i = 0; i < TICKETS; i++) await db.run("INSERT INTO tickets (project_id, title) VALUES (1, ?)", `${i} ${"x".repeat(480)}`);
    });
    await db.close();
  });

  after(() => close());

  const link = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: { project: "Big Project", ...args } });
    assert.ok(!r.isError, JSON.stringify(r.content).slice(0, 300));
    const [text, resource] = r.content as [{ type: string; text: string }, { type: string; uri: string; mimeType: string }];
    assert.equal(resource.type, "resource_link");
    assert.match(text.text, /is over 5 MB, too large to return here\. Read it from the resource/);
    return resource;
  };

  const read = async (uri: string) => {
    const { contents } = await client.readResource({ uri });
    return (contents as { text: string; mimeType: string }[])[0];
  };

  it("links export_json to the export resource, which has the whole export", async () => {
    const resource = await link("export_json", { withHistory: true });
    assert.equal(resource.uri, "rewelo://Big%20Project/export/json-with-history");
    const content = await read(resource.uri);
    assert.equal(content.mimeType, "application/json");
    assert.equal(JSON.parse(content.text).tickets.length, TICKETS);
  });

  it("links export_csv, with or without the calculated columns", async () => {
    const plain = await link("export_csv", {});
    assert.equal(plain.uri, "rewelo://Big%20Project/export/csv");
    const calculated = await link("export_csv", { withCalculations: true });
    assert.equal(calculated.uri, "rewelo://Big%20Project/export/csv-with-calculations");
    const content = await read(calculated.uri);
    assert.equal(content.mimeType, "text/csv");
    const lines = content.text.trimEnd().split("\n");
    assert.match(lines[0], /priority/);
    assert.equal(lines.length, TICKETS + 1);
  });

  it("links report_dashboard with its limit", async () => {
    const resource = await link("report_dashboard", { limit: TICKETS });
    assert.equal(resource.uri, `rewelo://Big%20Project/dashboard/${TICKETS}`);
    const content = await read(resource.uri);
    assert.equal(content.mimeType, "text/html");
    assert.doesNotMatch(content.text, /Showing \d+ of/);
  });

  it("rejects an unknown export format or limit", async () => {
    await assert.rejects(read("rewelo://Big%20Project/export/xml"), /Unknown export format "xml": use csv, csv-with-calculations, json, json-with-history/);
    await assert.rejects(read("rewelo://Big%20Project/dashboard/lots"), /Invalid limit "lots"/);
  });
});
