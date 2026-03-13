import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP server", () => {
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
  });

  afterEach(async () => {
    await cleanup();
  });

  it("discovers all registered tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toContain("project_create");
    expect(names).toContain("ticket_create");
    expect(names).toContain("tag_create");
    expect(names).toContain("calc_priority");
    expect(names).toContain("report_summary");
    expect(names).toContain("export_csv");
    expect(names).toContain("import_csv");
    expect(names).toContain("server_version");
    expect(names.length).toBeGreaterThanOrEqual(19);
  });

  it("creates and lists projects", async () => {
    const createResult = await client.callTool({
      name: "project_create",
      arguments: { name: "TestProject" },
    });
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse((createResult.content as any)[0].text);
    expect(created.name).toBe("TestProject");

    const listResult = await client.callTool({
      name: "project_list",
      arguments: {},
    });
    const projects = JSON.parse((listResult.content as any)[0].text);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("TestProject");
  });

  it("creates ticket and lists with priority", async () => {
    await client.callTool({
      name: "project_create",
      arguments: { name: "Acme" },
    });

    await client.callTool({
      name: "ticket_create",
      arguments: {
        project: "Acme",
        title: "Login page",
        benefit: 8,
        penalty: 3,
        estimate: 5,
        risk: 2,
      },
    });

    const listResult = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme" },
    });
    const tickets = JSON.parse((listResult.content as any)[0].text);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].title).toBe("Login page");
    expect(tickets[0].priority).toBeCloseTo(1.57, 1);
  });

  it("creates and assigns tags", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Acme", title: "T1" },
    });

    const assignResult = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", ticket: "T1", prefix: "state", value: "backlog" },
    });
    const assigned = JSON.parse((assignResult.content as any)[0].text);
    expect(assigned.assigned).toBe(true);

    const tagList = await client.callTool({
      name: "tag_list",
      arguments: { project: "Acme" },
    });
    const tags = JSON.parse((tagList.content as any)[0].text);
    expect(tags.some((t: any) => t.prefix === "state" && t.value === "backlog")).toBe(true);
  });

  it("calculates priorities", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Acme", title: "A", benefit: 13, penalty: 8, estimate: 3, risk: 2 },
    });
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Acme", title: "B", benefit: 3, penalty: 2, estimate: 8, risk: 5 },
    });

    const result = await client.callTool({
      name: "calc_priority",
      arguments: { project: "Acme" },
    });
    const priorities = JSON.parse((result.content as any)[0].text);
    expect(priorities).toHaveLength(2);
    // A should rank higher
    expect(priorities[0].title).toBe("A");
  });

  it("returns error for invalid project name", async () => {
    const result = await client.callTool({
      name: "project_create",
      arguments: { name: "'; DROP TABLE--" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent project", async () => {
    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "NonExistent" },
    });
    expect(result.isError).toBe(true);
  });

  it("validates tag prefix format", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const result = await client.callTool({
      name: "tag_create",
      arguments: { project: "Acme", prefix: "INVALID CHARS!", value: "test" },
    });
    expect(result.isError).toBe(true);
  });

  it("generates project summary report", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const result = await client.callTool({
      name: "report_summary",
      arguments: { project: "Acme" },
    });
    const summary = JSON.parse((result.content as any)[0].text);
    expect(summary.totalTickets).toBe(0);
    expect(summary.byState).toEqual({});
  });

  it("exports and imports via CSV", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Source" } });
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Source", title: "Feature", benefit: 5, penalty: 3, estimate: 3, risk: 2 },
    });

    const exportResult = await client.callTool({
      name: "export_csv",
      arguments: { project: "Source" },
    });
    const csv = (exportResult.content as any)[0].text;
    expect(csv).toContain("Feature");

    await client.callTool({ name: "project_create", arguments: { name: "Target" } });
    const importResult = await client.callTool({
      name: "import_csv",
      arguments: { project: "Target", csv },
    });
    const imported = JSON.parse((importResult.content as any)[0].text);
    expect(imported.imported).toBe(1);
  });
});
