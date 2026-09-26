import { Command } from "commander";
import { warnIfNoVolume } from "../../volume.js";
import { resolveDbPath } from "../context.js";
import { duckDbMigration, legacyDuckDb } from "../../validation/paths.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("start MCP server (stdio transport)")
    .option("--channel", "push changes made elsewhere into a Claude Code session (channels, research preview)")
    .action(async (cmdOpts: { channel?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const dbPath = resolveDbPath(opts);
      warnIfNoVolume(dbPath);
      // The server creates the database on the first call: say that an old
      // one's projects won't be in it
      const legacy = legacyDuckDb(dbPath);
      if (legacy) console.error(`rewelo: ${dbPath} does not exist, but ${legacy}, a database of rewelo 0.4 or older, does; its projects won't be in the new database. ${duckDbMigration(legacy)}`);
      // Loaded on demand: the MCP SDK roughly quadruples CLI startup time,
      // and no other command needs it.
      const { startMcpServer } = await import("../../mcp/server.js");
      await startMcpServer(dbPath, { channel: cmdOpts.channel });
    });
}
