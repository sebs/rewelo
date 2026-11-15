import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

// The dashboard as an MCP App (SEP-1865, specification 2026-01-26): a host
// that supports it renders report_dashboard's result in its UI resource
describe("MCP App: the dashboard", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = createMcpServer(":memory:");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(() => close());

  it("links report_dashboard to its UI resource, under the current key and the deprecated one", async () => {
    const { tools } = await client.listTools();
    const dashboard = tools.find((t) => t.name === "report_dashboard")!;
    assert.deepEqual(dashboard._meta, { ui: { resourceUri: "ui://rewelo/dashboard.html" }, "ui/resourceUri": "ui://rewelo/dashboard.html" });
    // No other tool has a UI
    assert.deepEqual(tools.filter((t) => t._meta?.ui).map((t) => t.name), ["report_dashboard"]);
  });

  it("serves the app as one self-contained HTML document with the MCP App type", async () => {
    const { contents } = await client.readResource({ uri: "ui://rewelo/dashboard.html" });
    const [app] = contents as { uri: string; mimeType: string; text: string }[];
    assert.equal(app.mimeType, "text/html;profile=mcp-app");
    assert.match(app.text, /^<!doctype html>/);
    // The host's default CSP blocks anything loaded from elsewhere
    assert.doesNotMatch(app.text, /<script[^>]+src=|<link[^>]+href=|https?:\/\//);
    // The handshake and the result it waits for
    assert.match(app.text, /"ui\/initialize"/);
    assert.match(app.text, /"2026-01-26"/);
    assert.match(app.text, /"ui\/notifications\/tool-result"/);
  });

  it("lists the app among the resources", async () => {
    const { resources } = await client.listResources();
    const app = resources.find((r) => r.uri === "ui://rewelo/dashboard.html");
    assert.equal(app?.mimeType, "text/html;profile=mcp-app");
  });

  it("still returns the dashboard as HTML text for hosts without apps", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const r = await client.callTool({ name: "report_dashboard", arguments: { project: "Acme" } });
    assert.match((r.content as any)[0].text, /^<!doctype html>[\s\S]*<h1>Acme<\/h1>/);
  });
});
