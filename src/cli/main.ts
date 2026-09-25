import { Command } from "commander";
import { sanitizeError } from "../validation/errors.js";
import { VERSION } from "../version.generated.js";
import { refuseRepeatedOptions } from "./options.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerTicketCommands } from "./commands/ticket.js";
import { registerTagCommands } from "./commands/tag.js";
import { registerRelationCommands } from "./commands/relation.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerCalcCommands } from "./commands/calc.js";
import { registerTransferCommands } from "./commands/transfer.js";
import { registerReportCommands } from "./commands/report.js";
import { registerServeCommand } from "./commands/serve.js";

// Output piped into e.g. `head` may be closed early: stop quietly, as other
// command-line tools do, instead of crashing with an unhandled EPIPE (or
// ENOTCONN when stdout is a socket, as for child processes Node spawns)
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE" || err.code === "ENOTCONN") process.exit(0);
  throw err;
});

const program = new Command();

program
  .name("rw")
  .description("Relative Weight CLI - prioritisation tool")
  .version(VERSION)
  .option("--db <path>", "path to SQLite database file")
  .option("--json", "output as JSON")
  .option("--csv", "output as CSV")
  .option("--quiet", "minimal output")
  // rw prints no colour; the flag is still accepted so existing scripts work
  .option("--no-color", "accepted for compatibility (rw never prints colour)");

// In this order, which is the order of rw --help
registerProjectCommands(program);
registerTicketCommands(program);
registerTagCommands(program);
registerRelationCommands(program);
registerConfigCommands(program);
registerCalcCommands(program);
registerTransferCommands(program);
registerReportCommands(program);
registerServeCommand(program);

refuseRepeatedOptions(program);

// Every command's errors end here: the message (never a stack trace or SQL)
// on stderr, and exit code 1
program.parseAsync().catch((err) => {
  console.error(sanitizeError(err));
  process.exit(1);
});
