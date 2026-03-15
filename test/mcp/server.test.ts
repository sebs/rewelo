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
    const ticketResult = JSON.parse((listResult.content as any)[0].text);
    expect(ticketResult.items).toHaveLength(1);
    expect(ticketResult.items[0].title).toBe("Login page");
    expect(ticketResult.items[0].priority).toBeCloseTo(1.57, 1);
  });

  it("creates and assigns tags", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Acme", title: "T1" },
    });
    await client.callTool({
      name: "tag_create",
      arguments: { project: "Acme", prefix: "state", value: "backlog" },
    });

    const assignResult = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", ticket: "T1", prefix: "state", value: "backlog" },
    });
    const assigned = JSON.parse((assignResult.content as any)[0].text);
    expect(assigned[0].status).toBe("assigned");

    const tagList = await client.callTool({
      name: "tag_list",
      arguments: { project: "Acme" },
    });
    const tags = JSON.parse((tagList.content as any)[0].text);
    expect(tags.some((t: any) => t.prefix === "state" && t.value === "backlog")).toBe(true);
  });

  it("assigns multiple tags to a single ticket", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({
      name: "ticket_create",
      arguments: { project: "Acme", title: "T1" },
    });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "state", value: "backlog" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "team", value: "backend" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: {
        project: "Acme",
        ticket: "T1",
        tags: [
          { prefix: "state", value: "backlog" },
          { prefix: "team", value: "backend" },
        ],
      },
    });
    const out = JSON.parse((result.content as any)[0].text);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ ticket: "T1", tag: "state:backlog", status: "assigned" });
    expect(out[1]).toEqual({ ticket: "T1", tag: "team:backend", status: "assigned" });
  });

  it("assigns one tag to multiple tickets", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T1" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T2" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "state", value: "backlog" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: {
        project: "Acme",
        tickets: ["T1", "T2"],
        prefix: "state",
        value: "backlog",
      },
    });
    const out = JSON.parse((result.content as any)[0].text);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ ticket: "T1", tag: "state:backlog", status: "assigned" });
    expect(out[1]).toEqual({ ticket: "T2", tag: "state:backlog", status: "assigned" });
  });

  it("assigns multiple tags to multiple tickets", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T1" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T2" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "state", value: "backlog" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "team", value: "frontend" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: {
        project: "Acme",
        tickets: ["T1", "T2"],
        tags: [
          { prefix: "state", value: "backlog" },
          { prefix: "team", value: "frontend" },
        ],
      },
    });
    const out = JSON.parse((result.content as any)[0].text);
    expect(out).toHaveLength(4);
  });

  it("rejects tag_assign with no ticket specified", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", prefix: "state", value: "backlog" },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects tag_assign with no tag specified", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T1" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", ticket: "T1" },
    });
    expect(result.isError).toBe(true);
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

  it("filters by multiple tags (intersection)", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T1" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T2" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T3" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "state", value: "backlog" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "team", value: "backend" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "Acme", ticket: "T1", prefix: "state", value: "backlog" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "Acme", ticket: "T2", prefix: "state", value: "backlog" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "Acme", ticket: "T1", prefix: "team", value: "backend" } });

    // T1 has both tags, T2 only has state:backlog
    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", tags: ["state:backlog", "team:backend"] },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("T1");
  });

  it("excludes tickets by tag", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T1" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T2" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Acme", prefix: "state", value: "done" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "Acme", ticket: "T1", prefix: "state", value: "done" } });

    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", excludeTags: ["state:done"] },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("T2");
  });

  it("searches tickets by title", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "Login page" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "Signup flow" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "Dashboard" } });

    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", search: "log" },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("Login page");
  });

  it("paginates with limit and offset", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "A", benefit: 13, penalty: 8, estimate: 3, risk: 2 } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "B", benefit: 8, penalty: 5, estimate: 5, risk: 3 } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "C", benefit: 3, penalty: 2, estimate: 8, risk: 5 } });

    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", sort: "priority", limit: 2, offset: 0 },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.total).toBe(3);
    expect(data.items).toHaveLength(2);

    // Page 2
    const page2 = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", sort: "priority", limit: 2, offset: 2 },
    });
    const data2 = JSON.parse((page2.content as any)[0].text);
    expect(data2.total).toBe(3);
    expect(data2.items).toHaveLength(1);
  });

  it("filters by min-priority threshold", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "High", benefit: 13, penalty: 8, estimate: 3, risk: 2 } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "Low", benefit: 1, penalty: 1, estimate: 13, risk: 8 } });

    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", minPriority: 2.0 },
    });
    const data = JSON.parse((result.content as any)[0].text);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].title).toBe("High");
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
