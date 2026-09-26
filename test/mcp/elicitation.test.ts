import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

type ElicitParams = { message: string; requestedSchema: { properties: Record<string, unknown> } };
type Answer = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

// A client that shows forms and answers each with answer(); asked records them
async function connect(options: { answer?: (params: ElicitParams) => Answer } = {}) {
  const server = createMcpServer(":memory:");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: options.answer ? { elicitation: { form: {} } } : {} }
  );
  const asked: ElicitParams[] = [];
  if (options.answer) {
    const answer = options.answer;
    client.setRequestHandler("elicitation/create", async (request) => {
      const params = request.params as unknown as ElicitParams;
      asked.push(params);
      return answer(params) as never;
    });
  }
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close = async () => {
    await client.close();
    await server.close();
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as { text: string }[])[0].text };
  };
  return { call, asked };
}

describe("MCP project_delete confirmation", () => {
  it("asks the user and deletes on confirmation", async () => {
    const { call, asked } = await connect({ answer: () => ({ action: "accept", content: { confirm: true } }) });
    await call("project_create", { name: "Acme" });
    await call("ticket_create", { project: "Acme", title: "A", benefit: 1, penalty: 1, estimate: 1, risk: 1 });
    const r = await call("project_delete", { name: "Acme" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(JSON.parse(r.text), { deleted: true });
    assert.equal(asked.length, 1);
    assert.match(asked[0].message, /Delete project "Acme" and all its data \(1 ticket,/);
    assert.deepEqual(JSON.parse((await call("project_list", {})).text), []);
  });

  for (const answer of [{ action: "decline" }, { action: "cancel" }, { action: "accept", content: { confirm: false } }] as Answer[]) {
    it(`keeps the project when the user answers ${JSON.stringify(answer)}`, async () => {
      const { call, asked } = await connect({ answer: () => answer });
      await call("project_create", { name: "Acme" });
      // Named as stored, however the name was given
      const r = await call("project_delete", { name: "  Acme  " });
      assert.equal(r.isError, true);
      assert.match(asked[0].message, /^Delete project "Acme" and all its data/);
      assert.match(r.text, /Project "Acme" was not deleted: the user did not confirm/);
      assert.equal(JSON.parse((await call("project_list", {})).text).length, 1);
    });
  }

  it("doesn't ask about a project that doesn't exist", async () => {
    const { call, asked } = await connect({ answer: () => ({ action: "accept", content: { confirm: true } }) });
    const r = await call("project_delete", { name: "Nope" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Project not found/);
    assert.equal(asked.length, 0);
  });

  it("deletes without asking when the client can't show forms", async () => {
    const { call } = await connect();
    await call("project_create", { name: "Acme" });
    assert.deepEqual(JSON.parse((await call("project_delete", { name: "Acme" })).text), { deleted: true });
  });
});

describe("MCP ticket_create score form", () => {
  it("asks only for the omitted scores and uses the answers", async () => {
    const { call, asked } = await connect({ answer: () => ({ action: "accept", content: { penalty: "8", risk: "13" } }) });
    await call("project_create", { name: "Acme" });
    const r = await call("ticket_create", { project: "Acme", title: "Login", benefit: 5, estimate: 3 });
    assert.equal(r.isError, false, r.text);
    const ticket = JSON.parse(r.text);
    assert.deepEqual([ticket.benefit, ticket.penalty, ticket.estimate, ticket.risk], [5, 8, 3, 13]);
    assert.equal(asked.length, 1);
    assert.deepEqual(Object.keys(asked[0].requestedSchema.properties), ["penalty", "risk"]);
    assert.deepEqual((asked[0].requestedSchema.properties.risk as { enum: string[] }).enum, ["1", "2", "3", "5", "8", "13", "21"]);
  });

  it("defaults the scores to 1 when the user declines or leaves them out", async () => {
    const answers: Answer[] = [{ action: "decline" }, { action: "accept", content: { benefit: "21" } }];
    const { call } = await connect({ answer: () => answers.shift()! });
    await call("project_create", { name: "Acme" });
    const declined = JSON.parse((await call("ticket_create", { project: "Acme", title: "A" })).text);
    assert.deepEqual([declined.benefit, declined.penalty, declined.estimate, declined.risk], [1, 1, 1, 1]);
    const partial = JSON.parse((await call("ticket_create", { project: "Acme", title: "B" })).text);
    assert.deepEqual([partial.benefit, partial.penalty, partial.estimate, partial.risk], [21, 1, 1, 1]);
  });

  it("creates nothing when the user cancels", async () => {
    const { call } = await connect({ answer: () => ({ action: "cancel" }) });
    await call("project_create", { name: "Acme" });
    const r = await call("ticket_create", { project: "Acme", title: "A" });
    assert.equal(r.isError, true);
    assert.match(r.text, /Ticket "A" was not created: the user cancelled/);
    assert.equal(JSON.parse((await call("ticket_list", { project: "Acme" })).text).total, 0);
  });

  it("rejects an answer that is not a Fibonacci value", async () => {
    const { call } = await connect({ answer: () => ({ action: "accept", content: { benefit: "4" } }) });
    await call("project_create", { name: "Acme" });
    const r = await call("ticket_create", { project: "Acme", title: "A" });
    assert.equal(r.isError, true);
    assert.match(r.text, /benefit: must be a Fibonacci value \(1, 2, 3, 5, 8, 13, 21\), got "4"/);
  });

  it("doesn't ask when every score is given, or the title is taken", async () => {
    const { call, asked } = await connect({ answer: () => ({ action: "accept", content: {} }) });
    await call("project_create", { name: "Acme" });
    await call("ticket_create", { project: "Acme", title: "A", benefit: 2, penalty: 2, estimate: 2, risk: 2 });
    const taken = await call("ticket_create", { project: "Acme", title: "A" });
    assert.equal(taken.isError, true);
    assert.match(taken.text, /A ticket with title "A" already exists in this project/);
    assert.equal(asked.length, 0);
  });
});
