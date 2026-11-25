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
    assert.deepEqual(tools.filter((t) => (t._meta?.ui as { resourceUri?: string })?.resourceUri).map((t) => t.name), ["report_dashboard"]);
  });

  it("offers the app, and only the app, the version it polls to stay live", async () => {
    const { tools } = await client.listTools();
    const version = tools.find((t) => t.name === "dashboard_version")!;
    assert.deepEqual(version._meta, { ui: { visibility: ["app"] } });
    assert.equal(version.annotations?.readOnlyHint, true);
  });

  it("says in the dashboard which version it shows, and changes the version with the data", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const versionNow = async () =>
      ((await client.callTool({ name: "dashboard_version", arguments: { project: "Acme" } })).structuredContent as { version: string }).version;

    const before = await versionNow();
    assert.equal(await versionNow(), before);
    const html = ((await client.callTool({ name: "report_dashboard", arguments: { project: "Acme", limit: 7 } })).content as any)[0].text;
    assert.match(html, new RegExp(`<meta name="rewelo-version" content="${before}">`));
    assert.match(html, /<meta name="rewelo-project" content="Acme">/);
    assert.match(html, /<meta name="rewelo-limit" content="7">/);
    // The page is shown in the app without its scripts: it has none anyway
    assert.doesNotMatch(html, /<script/);

    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "New" } });
    assert.notEqual(await versionNow(), before);
  });

  it("refuses a version for a project that doesn't exist, which stops the page refreshing", async () => {
    const r = await client.callTool({ name: "dashboard_version", arguments: { project: "Nope" } });
    assert.equal(r.isError, true);
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
    // Live: it polls dashboard_version, refreshes through report_dashboard, and stops on teardown
    assert.match(app.text, /name: "dashboard_version"/);
    assert.match(app.text, /name: "report_dashboard"/);
    assert.match(app.text, /setInterval\(poll, 5000\)/);
    assert.match(app.text, /"ui\/resource-teardown"/);
    // A refresh keeps every choice made on the dashboard (window, switches) and the dialogs open
    assert.match(app.text, /const chosen = choices\(\);/);
    assert.match(app.text, /dialogs: \[\.\.\.document\.querySelectorAll\("dialog\[open\]"\)\]/);
    // The ticket browser opens at its button in a frame as tall as the dashboard
    assert.match(app.text, /position-anchor: --rewelo-browse; top: anchor\(top\)/);
    assert.doesNotMatch(app.text, /__POLL_MS__|__VERSION__|__PROTOCOL__/);
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
