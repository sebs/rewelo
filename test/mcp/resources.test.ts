import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP resources", () => {
  let client: Client;
  let close: () => Promise<void>;

  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const read = async (uri: string) => {
    const { contents } = await client.readResource({ uri });
    const [content] = contents as { uri: string; mimeType: string; text: string }[];
    return content;
  };

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
    await call("project_create", { name: "My Project" });
    await call("ticket_create", { project: "My Project", title: "Low", benefit: 1, penalty: 1, estimate: 8, risk: 8 });
    await call("ticket_create", { project: "My Project", title: "API / v2", description: "Version two", benefit: 8, penalty: 5, estimate: 2, risk: 1 });
    await call("ticket_create", { project: "My Project", title: "Shipped", benefit: 21, penalty: 21, estimate: 1, risk: 1 });
    await call("tag_assign", { project: "My Project", ticket: "Shipped", prefix: "state", value: "done" });
    await call("tag_assign", { project: "My Project", ticket: "API / v2", prefix: "team", value: "core" });
    await call("relation_create", { project: "My Project", source: "API / v2", type: "blocks", target: "Low" });
  });

  afterEach(() => close());

  it("offers backlog, ticket and dashboard templates", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.deepEqual(
      resourceTemplates.map((t) => [t.name, t.uriTemplate, t.mimeType]).sort(),
      [
        ["backlog", "rewelo://{project}/backlog", "application/json"],
        ["dashboard", "rewelo://{project}/dashboard", "text/html"],
        ["ticket", "rewelo://{project}/ticket/{title}", "application/json"],
      ]
    );
  });

  it("lists a backlog and a dashboard per project, with the name encoded in the URI", async () => {
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri).sort(), ["rewelo://My%20Project/backlog", "rewelo://My%20Project/dashboard"]);
  });

  it("reads the backlog: open tickets, ranked, with their tags", async () => {
    const content = await read("rewelo://My%20Project/backlog");
    assert.equal(content.mimeType, "application/json");
    const backlog = JSON.parse(content.text);
    assert.deepEqual([backlog.project, backlog.openTickets, backlog.doneTickets], ["My Project", 2, 1]);
    assert.deepEqual(
      backlog.tickets.map((t: { rank: number; title: string; tags: string[] }) => [t.rank, t.title, t.tags]),
      [[1, "API / v2", ["team:core"]], [2, "Low", []]]
    );
    assert.equal(backlog.tickets[0].priority, 4.33);
  });

  it("reads a ticket by its encoded title, with description, tags and relations", async () => {
    const ticket = JSON.parse((await read(`rewelo://My%20Project/ticket/${encodeURIComponent("API / v2")}`)).text);
    assert.equal(ticket.title, "API / v2");
    assert.equal(ticket.description, "Version two");
    assert.deepEqual(ticket.tags, ["team:core"]);
    assert.deepEqual(ticket.relations.map((r: { relation_type: string; ticket_title: string }) => [r.relation_type, r.ticket_title]), [["blocks", "Low"]]);
  });

  it("reads the dashboard as HTML", async () => {
    const content = await read("rewelo://My%20Project/dashboard");
    assert.equal(content.mimeType, "text/html");
    assert.match(content.text, /^<!DOCTYPE html>/i);
    assert.match(content.text, /My Project/);
  });

  it("answers an unknown project or ticket as not found", async () => {
    await assert.rejects(read("rewelo://Nope/backlog"), /Project not found/);
    await assert.rejects(read("rewelo://My%20Project/ticket/Nope"), /Ticket "Nope" not found/);
  });

  it("completes the project and title variables", async () => {
    const projects = await client.complete({ ref: { type: "ref/resource", uri: "rewelo://{project}/ticket/{title}" }, argument: { name: "project", value: "my" } });
    assert.deepEqual(projects.completion.values, ["My Project"]);
    const titles = await client.complete({
      ref: { type: "ref/resource", uri: "rewelo://{project}/ticket/{title}" },
      argument: { name: "title", value: "api" },
      context: { arguments: { project: "My Project" } },
    });
    assert.deepEqual(titles.completion.values, ["API / v2"]);
  });
});
