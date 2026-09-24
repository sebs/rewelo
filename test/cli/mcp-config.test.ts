import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { BIN } from "./run.js";

describe("MCP server with .rewelo.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-mcp-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("falls back to the configured project in every project-scoped tool", async () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "P" }));
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN, "--db", join(dir, "x.db"), "serve"],
        cwd: dir,
      })
    );
    try {
      assert.match(client.getInstructions() ?? "", /The default project is "P" \(from \.rewelo\.json\)/);
      await client.callTool({ name: "project_create", arguments: { name: "P" } });
      await client.callTool({ name: "ticket_create", arguments: { title: "A" } });

      for (const name of ["tag_list", "weight_get", "weight_reset", "calc_weights", "report_times", "relation_list_all"]) {
        const r = await client.callTool({ name, arguments: {} });
        assert.ok(!r.isError, `${name}: ${(r.content as any)[0].text}`);
      }
    } finally {
      await client.close();
    }
  });

  it("reports a malformed .rewelo.json when a tool needs the fallback", async () => {
    const bad = mkdtempSync(join(tmpdir(), "rw-mcp-"));
    writeFileSync(join(bad, ".rewelo.json"), "{bad");
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN, "--db", join(bad, "x.db"), "serve"],
        cwd: bad,
      })
    );
    try {
      await client.callTool({ name: "project_create", arguments: { name: "P" } });
      const r = await client.callTool({ name: "tag_list", arguments: {} });
      assert.equal(r.isError, true);
      assert.ok(((r.content as any)[0].text).includes("Invalid JSON in"));
      assert.ok(!((await client.callTool({ name: "tag_list", arguments: { project: "P" } })).isError));
    } finally {
      await client.close();
      rmSync(bad, { recursive: true, force: true });
    }
  });

  it("says in its instructions when it found no default project", async () => {
    const none = mkdtempSync(join(tmpdir(), "rw-mcp-"));
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [BIN, "--db", join(none, "x.db"), "serve"], cwd: none })
    );
    try {
      assert.match(client.getInstructions() ?? "", /No \.rewelo\.json with a default project was found .* pass the project parameter/);
    } finally {
      await client.close();
      rmSync(none, { recursive: true, force: true });
    }
  });
});
