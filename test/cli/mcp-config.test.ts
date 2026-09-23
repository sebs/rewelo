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
});
