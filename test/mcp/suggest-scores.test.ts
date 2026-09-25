import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

// answer: what the client's model says to a sampling request, if the client supports sampling
async function connect(answer?: string) {
  const server = createMcpServer(":memory:");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: answer !== undefined ? { sampling: {} } : {} });
  const prompts: string[] = [];
  if (answer !== undefined) {
    client.setRequestHandler("sampling/createMessage", async (request) => {
      prompts.push((request.params.messages[0].content as { text: string }).text);
      return { role: "assistant", content: { type: "text", text: answer }, model: "test", stopReason: "endTurn" } as never;
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
    const text = (r.content as { text: string }[])[0].text;
    return { isError: r.isError === true, text, data: r.isError ? undefined : JSON.parse(text) };
  };
  await call("project_create", { name: "Acme" });
  await call("ticket_create", { project: "Acme", title: "Login page", benefit: 8, penalty: 3, estimate: 5, risk: 2 });
  await call("ticket_create", { project: "Acme", title: "Dark mode", benefit: 2, penalty: 1, estimate: 8, risk: 3 });
  return { call, prompts };
}

describe("MCP suggest_scores", () => {
  it("returns similar tickets, references and the distribution, without asking a model", async () => {
    const { call, prompts } = await connect('{"benefit": 1, "penalty": 1, "estimate": 1, "risk": 1}');
    const r = await call("suggest_scores", { project: "Acme", title: "Login page redesign" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.tickets, 2);
    assert.deepEqual(r.data.similar.map((s: { title: string }) => s.title), ["Login page"]);
    assert.deepEqual(r.data.references.estimate.map((e: { score: number; title: string }) => [e.score, e.title]), [[5, "Login page"], [8, "Dark mode"]]);
    assert.deepEqual(r.data.distribution, (await call("report_distribution", { project: "Acme" })).data);
    assert.equal(r.data.sampling, undefined);
    assert.deepEqual(prompts, []);
  });

  it("asks the client's model with sample, and returns its scores", async () => {
    const { call, prompts } = await connect('Here: {"benefit": 8, "penalty": 2, "estimate": 3, "risk": 1, "reasoning": "A smaller Login page"}');
    const r = await call("suggest_scores", { project: "Acme", title: "Login page redesign", sample: true });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.sampling, "used");
    assert.deepEqual(r.data.suggestion, { benefit: 8, penalty: 2, estimate: 3, risk: 1, reasoning: "A smaller Login page" });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /New ticket: "Login page redesign"/);
    assert.match(prompts[0], /estimate:\n {2}5: "Login page"\n {2}8: "Dark mode"/);
  });

  it("says when the model's answer has no valid scores", async () => {
    const { call } = await connect('{"benefit": 4, "penalty": 2, "estimate": 3, "risk": 1}');
    const r = await call("suggest_scores", { project: "Acme", title: "Login page redesign", sample: true });
    assert.equal(r.data.sampling, "failed");
    assert.equal(r.data.suggestion, undefined);
  });

  it("says when the client can't sample", async () => {
    const { call } = await connect();
    const r = await call("suggest_scores", { project: "Acme", title: "Login page redesign", sample: true });
    assert.equal(r.data.sampling, "unsupported");
    assert.ok(r.data.references);
  });
});
