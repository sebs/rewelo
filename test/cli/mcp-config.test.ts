import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

describe("MCP server with .rewelo.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "rw-mcp-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("falls back to the configured project in every project-scoped tool", async () => {
    writeFileSync(join(dir, ".rewelo.json"), JSON.stringify({ project: "P" }));
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve(__dirname, "../../dist/index.js"), "--db", join(dir, "x.db"), "serve"],
        cwd: dir,
      })
    );
    try {
      await client.callTool({ name: "project_create", arguments: { name: "P" } });
      await client.callTool({ name: "ticket_create", arguments: { title: "A" } });

      for (const name of ["tag_list", "weight_get", "weight_reset", "calc_weights", "report_times", "relation_list_all"]) {
        const r = await client.callTool({ name, arguments: {} });
        expect(r.isError, `${name}: ${(r.content as any)[0].text}`).toBeFalsy();
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
        args: [resolve(__dirname, "../../dist/index.js"), "--db", join(bad, "x.db"), "serve"],
        cwd: bad,
      })
    );
    try {
      await client.callTool({ name: "project_create", arguments: { name: "P" } });
      const r = await client.callTool({ name: "tag_list", arguments: {} });
      expect(r.isError).toBe(true);
      expect((r.content as any)[0].text).toContain("Invalid JSON in");
      expect((await client.callTool({ name: "tag_list", arguments: { project: "P" } })).isError).toBeFalsy();
    } finally {
      await client.close();
      rmSync(bad, { recursive: true, force: true });
    }
  });
});
