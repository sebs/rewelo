import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp/server.js";

// build/test/mcp -> repository root
const SKILLS = resolve(__dirname, "../../../.claude/skills");

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

// cwd decides the default project: this repository's .rewelo.json names one
async function connect(cwd?: string) {
  const previous = process.cwd();
  if (cwd) process.chdir(cwd);
  let server;
  try {
    server = createMcpServer(":memory:");
  } finally {
    process.chdir(previous);
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close = async () => {
    await client.close();
    await server.close();
  };
  return client;
}

const text = (r: { messages: { content: unknown }[] }) => (r.messages[0].content as { text: string }).text;

describe("MCP prompts", () => {
  it("offers every skill in .claude/skills as a prompt, with its description", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    const skills = readdirSync(SKILLS).sort();
    assert.deepEqual(prompts.map((p) => p.name).sort(), skills);
    for (const skill of skills) {
      const description = /^description: (.*)$/m.exec(readFileSync(join(SKILLS, skill, "SKILL.md"), "utf-8"))![1];
      assert.equal(prompts.find((p) => p.name === skill)!.description, description, skill);
    }
    const planSprint = prompts.find((p) => p.name === "plan-sprint")!;
    assert.deepEqual(planSprint.arguments!.map((a) => [a.name, a.required ?? false]), [["project", false], ["capacity-points", false]]);
  });

  it("fills the skill's text with the arguments, without its front matter", async () => {
    const client = await connect();
    const r = await client.getPrompt({ name: "plan-sprint", arguments: { project: "Acme", "capacity-points": "30" } });
    const body = text(r);
    assert.match(body, /^# /);
    assert.match(body, /Plan a sprint for project \*\*Acme\*\* with a capacity of \*\*30\*\* effort points/);
    assert.doesNotMatch(body, /\$\d|allowed-tools/);
  });

  it("uses the default project, or asks for one, when the project is left out", async () => {
    const withDefault = await connect();
    assert.match(text(await withDefault.getPrompt({ name: "standup", arguments: {} })), /summary for project \*\*rewelo\*\*/);
    await close!();

    const dir = mkdtempSync(join(tmpdir(), "rw-prompts-"));
    try {
      const without = await connect(dir);
      const body = text(await without.getPrompt({ name: "reprioritize", arguments: {} }));
      assert.match(body, /project \*\*\(no project given: ask the user which one, or call project_list\)\*\* in light of: \*\*\(not given\)\*\*/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("completes project names and the titles of the named project's tickets", async () => {
    const client = await connect();
    for (const name of ["Acme", "Beta", "acme-labs"]) await client.callTool({ name: "project_create", arguments: { name } });
    for (const title of ["Login page", "Logout", "Signup"]) {
      await client.callTool({ name: "ticket_create", arguments: { project: "Acme", title, benefit: 1, penalty: 1, estimate: 1, risk: 1 } });
    }

    const projects = await client.complete({ ref: { type: "ref/prompt", name: "slice" }, argument: { name: "project", value: "acm" } });
    assert.deepEqual(projects.completion.values.sort(), ["Acme", "acme-labs"]);

    const titles = await client.complete({
      ref: { type: "ref/prompt", name: "slice" },
      argument: { name: "ticket-title", value: "log" },
      context: { arguments: { project: "Acme" } },
    });
    assert.deepEqual(titles.completion.values.sort(), ["Login page", "Logout"]);

    const unknown = await client.complete({
      ref: { type: "ref/prompt", name: "slice" },
      argument: { name: "ticket-title", value: "" },
      context: { arguments: { project: "Nope" } },
    });
    assert.deepEqual(unknown.completion.values, []);
  });
});
