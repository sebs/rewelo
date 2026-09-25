import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";
import { PROMPTS } from "../../src/mcp/prompts.generated.js";
import { parseTag } from "../../src/validation/strings.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { childEnv } from "../cli/run.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";

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

  it("doesn't tell models to create a tag before tag_assign, which creates missing tags", async () => {
    const { tools } = await client.listTools();
    const texts = [...tools.map((t) => `${t.name}: ${t.description}`), ...PROMPTS.map((p) => `prompt ${p.name}: ${p.body}`)];
    const stale = texts.filter((t) => /required before using tag_assign|create the tag first/i.test(t));
    assert.deepEqual(stale.map((t) => t.split(":")[0]), []);
  });

  it("spells out only valid tags in its prompts, which tag_assign would accept", () => {
    const invalid = PROMPTS.flatMap((p) =>
      [...p.body.matchAll(/`([a-z][a-z0-9-]*:[^`\s]+)`/g)].map((m) => m[1]).filter((tag) => {
        try {
          parseTag(tag);
          return false;
        } catch {
          return true;
        }
      }).map((tag) => `${p.name}: ${tag}`)
    );
    assert.deepEqual(invalid, []);
  });

  it("keeps sprint membership apart from the state in its prompts: state:done replaces a state:sprint", () => {
    assert.deepEqual(PROMPTS.filter((p) => p.body.includes("state:sprint")).map((p) => p.name), []);
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

  it("tag_assign applies and creates nothing when any ticket in the batch is missing", async () => {
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

    const newTag = await assign({ tickets: ["A", "nope"], tags: [{ prefix: "state", value: "wip" }, { prefix: "zzz", value: "x" }] });
    assert.equal(newTag.isError, true);
    assert.deepEqual(await tagged("state:wip"), []);
    const tagList = await client.callTool({ name: "tag_list", arguments: { project: "Batch" } });
    assert.doesNotMatch((tagList.content as any)[0].text, /zzz/);

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

  it("calc_priority and calc_weights narrow the scope with several tags, as the CLI's --tag does", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "T" } });
    for (const title of ["A", "B", "C"]) {
      await client.callTool({ name: "ticket_create", arguments: { project: "T", title } });
    }
    await client.callTool({ name: "tag_assign", arguments: { project: "T", tickets: ["A", "B"], prefix: "team", value: "x" } });
    await client.callTool({ name: "tag_assign", arguments: { project: "T", tickets: ["B", "C"], prefix: "area", value: "api" } });

    const titles = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: { project: "T", ...args } });
      assert.notEqual(r.isError, true, (r.content as any)[0].text);
      return JSON.parse((r.content as any)[0].text).map((t: any) => t.title);
    };
    // Every tag, from tag and tags together
    assert.deepEqual(await titles("calc_priority", { tags: ["team:x", "area:api"] }), ["B"]);
    assert.deepEqual(await titles("calc_priority", { tag: "team:x", tags: ["area:api"] }), ["B"]);
    assert.deepEqual(await titles("calc_weights", { tags: ["team:x", "area:api"] }), ["B"]);
  });

  it("project_delete reports a missing project as an error", async () => {
    const r = await client.callTool({ name: "project_delete", arguments: { name: "Nope" } });
    assert.equal(r.isError, true);
    assert.match((r.content as any)[0].text, /Project not found/);
  });

  it("ticket_history rejects a fractional id in the schema", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "H" } });
    const r = await client.callTool({ name: "ticket_history", arguments: { project: "H", id: 2.5 } });
    assert.equal(r.isError, true);
    assert.doesNotMatch((r.content as any)[0].text, /not found/);
  });

  it("ticket_list rejects an empty sort field instead of ignoring it", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "S" } });
    const r = await client.callTool({ name: "ticket_list", arguments: { project: "S", sort: "" } });
    assert.equal(r.isError, true);
    assert.match((r.content as any)[0].text, /Invalid sort field ""/);
  });

  it("rejects a blank project instead of claiming none was given", async () => {
    const r = await client.callTool({ name: "ticket_list", arguments: { project: "" } });
    assert.equal(r.isError, true);
    assert.match((r.content as any)[0].text, /project must not be empty/);
  });

  it("tag_assign handles a large tickets array within the payload limit", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "L" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "L", title: "A" } });
    const r = await client.callTool({
      name: "tag_assign",
      arguments: { project: "L", tickets: Array(130_000).fill("A"), prefix: "a", value: "b" },
    });
    assert.deepEqual(JSON.parse((r.content as any)[0].text), [{ ticket: "A", tag: "a:b", status: "assigned", tagCreated: true }]);
  });

  it("tag_assign creates tags that don't exist yet, as rw tag assign does", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "New" } });
    for (const title of ["A", "B"]) await client.callTool({ name: "ticket_create", arguments: { project: "New", title } });
    const r = await client.callTool({ name: "tag_assign", arguments: { project: "New", tickets: ["A", "B"], prefix: "state", value: "wip" } });
    assert.deepEqual(JSON.parse((r.content as any)[0].text), [
      { ticket: "A", tag: "state:wip", status: "assigned", tagCreated: true },
      { ticket: "B", tag: "state:wip", status: "assigned" },
    ]);
  });

  it("tag_assign rejects a prefix without a value even when tags are given", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "H" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "H", title: "A" } });
    await client.callTool({ name: "tag_create", arguments: { project: "H", prefix: "x", value: "v" } });
    const r = await client.callTool({
      name: "tag_assign",
      arguments: { project: "H", ticket: "A", prefix: "state", tags: [{ prefix: "x", value: "v" }] },
    });
    assert.equal(r.isError, true);
    assert.match((r.content as any)[0].text, /Provide both prefix and value/);
  });

  it("measures the payload limit on the argument, not its JSON escaping", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Big" } });
    // about 600 KB, but over 1 MB once every backslash is escaped
    const csv = "title\n" + Array.from({ length: 6000 }, (_, i) => `T${i}${"\\".repeat(95)}`).join("\n");
    const r = await client.callTool({ name: "import_csv", arguments: { project: "Big", csv } });
    assert.doesNotMatch((r.content as any)[0].text, /payload too large/);
  });

  it("exposes exactly the tools features/mcp-server.feature lists", async () => {
    // build/test/mcp -> repository root
    const spec = readFileSync(resolve(__dirname, "../../../features/mcp-server.feature"), "utf-8");
    const table = spec.slice(spec.indexOf("| tool "), spec.indexOf("# -- Tool invocation --"));
    const specified = [...table.matchAll(/^\s*\| ([a-z_]+) +\|$/gm)].map((m) => m[1]).filter((name) => name !== "tool").sort();
    const registered = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(registered, specified);
  });

  it("rw serve logs its version, transport and database on stderr", async () => {
    const child = spawn(process.execPath, [resolve(__dirname, "../../src/index.js"), "--db", ":memory:", "serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv(),
    });
    const line = await new Promise<string>((resolveLine) => child.stderr!.once("data", (d) => resolveLine(String(d))));
    child.kill();
    assert.match(line, /^rewelo \S+ MCP server on stdio transport, database :memory:/);
  });

  it("finishes writing the answer on its way out when stopped (SIGTERM)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-term-"));
    const path = join(dir, "t.db");
    const db = await DB.open(path);
    await (await import("../../src/db/migrate.js")).migrate(db);
    await db.run("INSERT INTO projects (id, name) VALUES (1, 'P')");
    await db.transaction(async () => {
      for (let i = 0; i < 3_000; i++) await db.run("INSERT INTO tickets (project_id, title) VALUES (1, ?)", `${i} ${"x".repeat(400)}`);
    });
    await db.close();

    const child = spawn(process.execPath, [resolve(__dirname, "../../src/index.js"), "--db", path, "serve"], {
      stdio: ["pipe", "pipe", "ignore"],
      env: childEnv(),
    });
    // "close": the process has exited and its stdout has been read to the end
    const exited = new Promise((done) => child.once("close", done));
    const send = (m: object) => child.stdin!.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ticket_list", arguments: { project: "P", limit: 3_000 } } });

    // Stop the server once the large answer has started, while most of it
    // still waits to be written: the client doesn't read in the meantime
    let out = "";
    let stopped = false;
    await new Promise<void>((started) => {
      child.stdout!.on("data", (chunk) => {
        out += chunk;
        const lines = out.split("\n");
        if (!stopped && lines.length > 1 && lines[1].length > 0) {
          stopped = true;
          child.stdout!.pause();
          child.kill("SIGTERM");
          setTimeout(() => (child.stdout!.resume(), started()), 300);
        }
      });
    });
    await exited;
    rmSync(dir, { recursive: true, force: true });

    const lines = out.split("\n").filter((l) => l.length > 0);
    const answer = JSON.parse(lines[1]);
    assert.equal(answer.id, 2);
    assert.equal(JSON.parse(answer.result.content[0].text).items.length, 3_000);
  });

  it("applies the payload limit to every tool and never echoes a huge input", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Big" } });
    const huge = await client.callTool({ name: "ticket_update", arguments: { project: "Big", title: "x".repeat(2_000_000) } });
    assert.equal(huge.isError, true);
    assert.match((huge.content as any)[0].text, /^Request payload too large/);

    const long = await client.callTool({ name: "ticket_update", arguments: { project: "Big", title: "y".repeat(900_000) } });
    assert.ok((long.content as any)[0].text.length < 2000);
  });

  it("pages ticket_list by 100 by default and refuses results over 5 MB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-big-"));
    const path = join(dir, "big.db");
    const server = createMcpServer(path);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const big = new Client({ name: "big", version: "1" });
    await server.connect(serverTransport);
    await big.connect(clientTransport);
    try {
      await big.callTool({ name: "project_create", arguments: { name: "Big" } });
      const db = await DB.open(path);
      await db.transaction(async () => {
        for (let i = 0; i < 12_000; i++) await db.run("INSERT INTO tickets (project_id, title) VALUES (1, ?)", `${i} ${"x".repeat(480)}`);
      });
      await db.close();

      const page = await big.callTool({ name: "ticket_list", arguments: { project: "Big" } });
      const body = JSON.parse((page.content as any)[0].text);
      assert.deepEqual([body.total, body.items.length], [12_000, 100]);

      const all = await big.callTool({ name: "ticket_list", arguments: { project: "Big", limit: 12_000 } });
      assert.equal(all.isError, true);
      assert.match((all.content as any)[0].text, /The result is too large/);
    } finally {
      await big.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("truncates a long error message without splitting an emoji", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Emoji" } });
    const result = await client.callTool({ name: "ticket_list", arguments: { project: "Emoji", tag: "😀".repeat(600) } });
    const text = (result.content as any)[0].text as string;
    assert.equal(result.isError, true);
    assert.match(text, /… \(truncated\)$/);
    assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("tells MCP clients to raise the dashboard's limit parameter, not the CLI option", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Dash" } });
    for (const title of ["A", "B"]) await client.callTool({ name: "ticket_create", arguments: { project: "Dash", title } });
    const result = await client.callTool({ name: "report_dashboard", arguments: { project: "Dash", limit: 1 } });
    const html = (result.content as any)[0].text as string;
    assert.match(html, /Showing 1 of 2 open tickets; a higher <code>limit<\/code> for <code>report_dashboard<\/code> shows more/);
    assert.doesNotMatch(html, /rw report dashboard/);
  });

  it("shortens the SDK's own errors, which quote the input", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Big" } });
    const invalid = await client.callTool({ name: "tag_assign", arguments: { project: "Big", ticket: "A", tags: Array(20_000).fill(1) } });
    assert.equal(invalid.isError, true);
    assert.ok((invalid.content as any)[0].text.length < 1100);

    const unknown = await client.callTool({ name: "x".repeat(100_000), arguments: {} }).then(
      (r) => (r.content as any)[0].text as string,
      (err: Error) => err.message
    );
    assert.ok(unknown.length < 1100, `${unknown.length} characters`);
  });

  it("names the allowed scores when one is invalid", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Scores" } });
    const r = await client.callTool({ name: "ticket_create", arguments: { project: "Scores", title: "Z", benefit: 4 } });
    assert.equal(r.isError, true);
    assert.match((r.content as any)[0].text, /benefit: must be a Fibonacci value \(1, 2, 3, 5, 8, 13, 21\), got 4/);
  });

  it("rejects unknown parameters and weight_set without a weight", async () => {
    await client.callTool({ name: "project_create", arguments: { name: "Strict" } });
    await client.callTool({ name: "ticket_create", arguments: { project: "Strict", title: "T1" } });
    const typo = await client.callTool({ name: "ticket_update", arguments: { project: "Strict", title: "T1", benfit: 5 } });
    assert.equal(typo.isError, true);
    assert.match((typo.content as any)[0].text, /benfit/);

    const empty = await client.callTool({ name: "weight_set", arguments: { project: "Strict" } });
    assert.equal(empty.isError, true);
    assert.match((empty.content as any)[0].text, /Provide at least one of w1, w2, w3, w4/);

    const { tools } = await client.listTools();
    assert.ok(tools.every((t) => (t.inputSchema as { additionalProperties?: boolean }).additionalProperties === false));
  });
});
