import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
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
    assert.ok(names.includes("project_create"));
    assert.ok(names.includes("ticket_create"));
    assert.ok(names.includes("tag_create"));
    assert.ok(names.includes("calc_priority"));
    assert.ok(names.includes("report_summary"));
    assert.ok(names.includes("export_csv"));
    assert.ok(names.includes("import_csv"));
    assert.ok(names.includes("server_version"));
    assert.ok(names.length >= 19);
  });

  it("creates and lists projects", async () => {
    const createResult = await client.callTool({
      name: "project_create",
      arguments: { name: "TestProject" },
    });
    assert.ok(!createResult.isError);
    const created = JSON.parse((createResult.content as any)[0].text);
    assert.equal(created.name, "TestProject");

    const listResult = await client.callTool({
      name: "project_list",
      arguments: {},
    });
    const projects = JSON.parse((listResult.content as any)[0].text);
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "TestProject");
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
    assert.equal(ticketResult.items.length, 1);
    assert.equal(ticketResult.items[0].title, "Login page");
    assert.ok(Math.abs(ticketResult.items[0].priority - (1.57)) < 10 ** -(1) / 2);
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
    assert.equal(assigned[0].status, "assigned");

    const tagList = await client.callTool({
      name: "tag_list",
      arguments: { project: "Acme" },
    });
    const tags = JSON.parse((tagList.content as any)[0].text);
    assert.equal(tags.some((t: any) => t.prefix === "state" && t.value === "backlog"), true);
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
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { ticket: "T1", tag: "state:backlog", status: "assigned" });
    assert.deepEqual(out[1], { ticket: "T1", tag: "team:backend", status: "assigned" });
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
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { ticket: "T1", tag: "state:backlog", status: "assigned" });
    assert.deepEqual(out[1], { ticket: "T2", tag: "state:backlog", status: "assigned" });
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
    assert.equal(out.length, 4);
  });

  it("rejects tag_assign with no ticket specified", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", prefix: "state", value: "backlog" },
    });
    assert.equal(result.isError, true);
  });

  it("rejects tag_assign with no tag specified", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title: "T1" } });
    const result = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Acme", ticket: "T1" },
    });
    assert.equal(result.isError, true);
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
    assert.equal(priorities.length, 2);
    // A should rank higher
    assert.equal(priorities[0].title, "A");
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
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, "T1");
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
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, "T2");
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
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, "Login page");
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
    assert.equal(data.total, 3);
    assert.equal(data.items.length, 2);

    // Page 2
    const page2 = await client.callTool({
      name: "ticket_list",
      arguments: { project: "Acme", sort: "priority", limit: 2, offset: 2 },
    });
    const data2 = JSON.parse((page2.content as any)[0].text);
    assert.equal(data2.total, 3);
    assert.equal(data2.items.length, 1);
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
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, "High");
  });

  it("returns error for invalid project name", async () => {
    const result = await client.callTool({
      name: "project_create",
      arguments: { name: "'; DROP TABLE--" },
    });
    assert.equal(result.isError, true);
  });

  it("returns error for non-existent project", async () => {
    const result = await client.callTool({
      name: "ticket_list",
      arguments: { project: "NonExistent" },
    });
    assert.equal(result.isError, true);
  });

  it("validates tag prefix format", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const result = await client.callTool({
      name: "tag_create",
      arguments: { project: "Acme", prefix: "INVALID CHARS!", value: "test" },
    });
    assert.equal(result.isError, true);
  });

  it("generates project summary report", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Acme" } });
    const result = await client.callTool({
      name: "report_summary",
      arguments: { project: "Acme" },
    });
    const summary = JSON.parse((result.content as any)[0].text);
    assert.equal(summary.totalTickets, 0);
    assert.deepEqual(summary.byState, {});
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
    assert.ok(csv.includes("Feature"));

    await client.callTool({ name: "project_create", arguments: { name: "Target" } });
    const importResult = await client.callTool({
      name: "import_csv",
      arguments: { project: "Target", csv },
    });
    const imported = JSON.parse((importResult.content as any)[0].text);
    assert.equal(imported.imported, 1);
  });

  it("tag_assign reports replaced same-prefix tags and rejects two values of one prefix", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Tags" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Tags", title: "A" } });
    for (const value of ["wip", "done"]) {
      await client.callTool({ name: "tag_create", arguments: { project: "Tags", prefix: "state", value } });
    }
    const assign = (args: Record<string, unknown>) =>
      client.callTool({ name: "tag_assign", arguments: { project: "Tags", ticket: "A", ...args } });

    const both = await assign({ tags: [{ prefix: "state", value: "wip" }, { prefix: "state", value: "done" }] });
    assert.equal(both.isError, true);
    assert.ok(((both.content as any)[0].text).includes('share the prefix "state"'));

    await assign({ prefix: "state", value: "wip" });
    const replace = await assign({ prefix: "state", value: "done" });
    assert.deepEqual(JSON.parse((replace.content as any)[0].text), [
      { ticket: "A", tag: "state:done", status: "assigned", replaced: ["state:wip"] },
    ]);
  });

  it("tag_assign applies nothing when any ticket or tag in the batch is missing", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Batch" } });
    for (const title of ["A", "B"]) {
      await client.callTool({ name: "ticket_create", arguments: { project: "Batch", title } });
    }
    await client.callTool({ name: "tag_create", arguments: { project: "Batch", prefix: "state", value: "wip" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Batch", prefix: "team", value: "core" } });
    const assign = (args: Record<string, unknown>) =>
      client.callTool({ name: "tag_assign", arguments: { project: "Batch", ...args } });
    const tagged = async (tag: string) => {
      const r = await client.callTool({ name: "ticket_list", arguments: { project: "Batch", tag } });
      return JSON.parse((r.content as any)[0].text).items.map((t: { title: string }) => t.title);
    };

    const missingTag = await assign({ ticket: "A", tags: [{ prefix: "state", value: "wip" }, { prefix: "zzz", value: "x" }] });
    assert.equal(missingTag.isError, true);
    assert.deepEqual(await tagged("state:wip"), []);

    const missingTicket = await assign({ tickets: ["A", "nope"], prefix: "team", value: "core" });
    assert.equal(missingTicket.isError, true);
    assert.deepEqual(await tagged("team:core"), []);
  });

  it("tag_assign processes a ticket named twice only once", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Twice" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Twice", title: "A" } });
    await client.callTool({ name: "tag_create", arguments: { project: "Twice", prefix: "state", value: "wip" } });

    const r = await client.callTool({
      name: "tag_assign",
      arguments: { project: "Twice", ticket: "A", tickets: ["A"], prefix: "state", value: "wip" },
    });
    assert.deepEqual(JSON.parse((r.content as any)[0].text), [{ ticket: "A", tag: "state:wip", status: "assigned" }]);
  });

  it("rejects non-integer, huge and negative limits with a validation error", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Lim" } });
    for (const name of ["project_history", "event_log", "ticket_list"]) {
      for (const limit of [1.5, 1e20, -1]) {
        const r = await client.callTool({ name, arguments: { project: "Lim", limit } });
        assert.equal(r.isError, true, `${name} limit=${limit}`);
        assert.ok(((r.content as any)[0].text).includes("Input validation error"), `${name} limit=${limit}`);
      }
    }
  });

  it("rejects negative or fractional topN and offset like the CLI", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Neg" } });
    const cases: [string, Record<string, number>][] = [
      ["report_summary", { topN: -1 }],
      ["report_summary", { topN: 1.5 }],
      ["ticket_list", { offset: -5 }],
      ["ticket_list", { offset: 0.5 }],
    ];
    for (const [name, args] of cases) {
      const r = await client.callTool({ name, arguments: { project: "Neg", ...args } });
      assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
      assert.ok(((r.content as any)[0].text).includes("Input validation error"));
    }
  });

  it("ticket_history rejects title and id together instead of naming the wrong one", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Hist" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Hist", title: "A" } });

    const both = await client.callTool({ name: "ticket_history", arguments: { project: "Hist", title: "A", id: 999 } });
    assert.equal(both.isError, true);
    assert.equal((both.content as any)[0].text, "Provide either title or id, not both");

    const byId = await client.callTool({ name: "ticket_history", arguments: { project: "Hist", id: 999 } });
    assert.equal((byId.content as any)[0].text, "Ticket #999 not found");
  });

  it("ticket_update rejects an empty newTitle", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Ren" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Ren", title: "A" } });
    const r = await client.callTool({ name: "ticket_update", arguments: { project: "Ren", title: "A", newTitle: "" } });
    assert.equal(r.isError, true);
    assert.equal((r.content as any)[0].text, "Ticket title must not be empty");
  });

  it("serves the dashboard, distribution and group reports documented in mcp.md", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "R" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "R", title: "A", benefit: 8 } });
    await client.callTool({ name: "tag_create", arguments: { project: "R", prefix: "team", value: "x" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "R", ticket: "A", prefix: "team", value: "x" } });

    const text = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError, name);
      return (r.content as any)[0].text as string;
    };
    assert.match(await text("report_dashboard", { project: "R" }), /^<!doctype html>/);
    const dist = JSON.parse(await text("report_distribution", { project: "R" }));
    assert.equal(dist.find((d: any) => d.dimension === "benefit").counts["8"], 1);
    assert.deepEqual(JSON.parse(await text("report_group", { project: "R", prefix: "team" })), [
      { value: "x", ticketCount: 1, averagePriority: 4.5 },
    ]);
  });

  it("calc_weights compares within a tagged subset like the CLI", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "W" } });
    for (const title of ["A", "B", "C"]) {
      await client.callTool({ name: "ticket_create", arguments: { project: "W", title } });
    }
    await client.callTool({ name: "tag_create", arguments: { project: "W", prefix: "team", value: "x" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "W", tickets: ["A", "B"], prefix: "team", value: "x" } });

    const r = await client.callTool({ name: "calc_weights", arguments: { project: "W", tag: "Team:X" } });
    const weights = JSON.parse((r.content as any)[0].text);
    assert.deepEqual(weights.map((w: any) => [w.title, w.relativeBenefit]), [["A", 0.5], ["B", 0.5]]);
  });
});
