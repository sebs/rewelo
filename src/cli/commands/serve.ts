import { Command } from "commander";
import { warnIfNoVolume } from "../../volume.js";
import { resolveDbPath } from "../context.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("start MCP server (stdio transport)")
    .option("--channel", "push changes made elsewhere into a Claude Code session (channels, research preview)")
    .action(async (cmdOpts: { channel?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const dbPath = resolveDbPath(opts);
      warnIfNoVolume(dbPath);
      // Loaded on demand: the MCP SDK roughly quadruples CLI startup time,
      // and no other command needs it.
      const { startMcpServer } = await import("../../mcp/server.js");
      await startMcpServer(dbPath, { channel: cmdOpts.channel });
    });
}
