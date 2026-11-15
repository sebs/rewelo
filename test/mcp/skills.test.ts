import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { createMcpServer } from "../../src/mcp/server.js";

// build/test/mcp -> repository root
const SKILLS = resolve(__dirname, "../../../.claude/skills");

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function connect() {
  const server = createMcpServer(":memory:");
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

describe("MCP skills (SEP-2640)", () => {
  it("serves every skill in .claude/skills under skill://rewelo/, with its name and description", async () => {
    const skills = new SkillsClient(await connect());
    assert.equal(skills.supported, true);
    const { skills: entries } = await skills.list();
    const dirs = readdirSync(SKILLS).sort();
    assert.deepEqual(entries.map((s) => s.uri), dirs.map((dir) => `skill://rewelo/${dir}/SKILL.md`));
    for (const entry of entries) {
      const dir = entry.uri.split("/")[3];
      const description = /^description: (.*)$/m.exec(readFileSync(join(SKILLS, dir, "SKILL.md"), "utf-8"))![1];
      assert.deepEqual([entry.frontmatter.name, entry.frontmatter.description], [dir, description]);
    }
  });

  it("sends a skill's SKILL.md as it is in the repository, and the client verifies it", async () => {
    const skills = new SkillsClient(await connect());
    const { skills: entries } = await skills.list();
    const planSprint = entries.find((s) => s.frontmatter.name === "plan-sprint")!;
    const file = await skills.read(planSprint);
    assert.equal(file.verified, true);
    assert.equal(file.text, readFileSync(join(SKILLS, "plan-sprint", "SKILL.md"), "utf-8"));
    // Claude Code's fields come along: the host decides what to do with them
    assert.match(String(file.frontmatter!["allowed-tools"]), /mcp__rewelo__calc_priority/);
  });

  it("keeps rewelo's own resources and prompts next to the skills", async () => {
    const client = await connect();
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.ok(resourceTemplates.some((t) => t.uriTemplate === "rewelo://{project}/backlog"));
    assert.equal((await client.listPrompts()).prompts.length, readdirSync(SKILLS).length);
  });
});
