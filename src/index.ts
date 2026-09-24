#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { DB } from "./db/connection.js";
import { warnIfNoVolume } from "./volume.js";
import { migrate } from "./db/migrate.js";
import {
  createProject,
  listProjects,
  deleteProject,
  getProjectByName,
  Project,
} from "./projects/repository.js";
import {
  createTicket,
  listTickets,
  getTicketByTitle,
  updateTicket,
  deleteTicket,
} from "./tickets/repository.js";
import {
  createTag,
  deleteTag,
  getTag,
  listTags,
  renameTag,
} from "./tags/repository.js";
import { assertOneValuePerPrefix, assignTag, removeTag } from "./tags/assignment.js";
import { getTagChangeLog } from "./tags/audit.js";
import { listRevisions, listProjectRevisions } from "./revisions/repository.js";
import { byPriority, exactPriority, priority, round2 } from "./calculations/priority.js";
import {
  calculateAllRelativeWeights,
} from "./calculations/relative-weights.js";
import { exactWeightedPriority, weightedPriority } from "./calculations/weighted-priority.js";
import { getWeights, setWeights, resetWeights, validateWeights } from "./weights/repository.js";
import { getProjectTimes, averageLeadTime, averageCycleTime, timesReport } from "./calculations/time.js";
import {
  validateProjectName,
  validateTicketTitle,
  validateTicketDescription,
  validateTagPrefix,
  validateTagValue,
  parseTagPair,
  parseTag,
  ValidationError,
} from "./validation/strings.js";
import { validateDbPath, validateExportPath, validateImportPath } from "./validation/paths.js";
import { describeFsError, sanitizeError } from "./validation/errors.js";
import { csvRow, exportCsv } from "./export/csv.js";
import { exportJson } from "./export/json.js";
import { importCsv, MAX_SIZE_BYTES as MAX_CSV_BYTES } from "./import/csv.js";
import { importJsonAsProject } from "./import/json.js";
import { MAX_JSON_SIZE_BYTES } from "./serialization/parse.js";
import { createRelation, removeRelation, listRelations, listProjectRelations } from "./relations/repository.js";
import { getRelationType, normalizeRelationType } from "./relations/types.js";
import { getProjectSummary } from "./reports/summary.js";
import { groupByTagPrefix } from "./reports/group.js";
import { getDistribution } from "./reports/distribution.js";
import { getBacklogHealth } from "./reports/health.js";
import { getEventLog } from "./reports/event-log.js";
import { renderDashboard } from "./reports/dashboard.js";
import { getProjectDiff } from "./reports/diff.js";
import { upsertTicket } from "./tickets/repository.js";
import { existsSync, statSync, writeFileSync as fsWriteFileSync, readFileSync as fsReadFileSync } from "fs";
import { loadConfig } from "./config.js";
import { VERSION } from "./version.generated.js";
import { displayWidth } from "./display-width.js";

const DEFAULT_DB = "./relative-weight.db";

// An empty or blank RW_DB_PATH (e.g. `RW_DB_PATH= rw …`) counts as unset.
// A path from the variable is named as such when it is rejected.
function resolveDbPath(opts: { db?: string }): string {
  const fromEnv = process.env.RW_DB_PATH?.trim() || undefined;
  const path = opts.db ?? fromEnv ?? DEFAULT_DB;
  try {
    return validateDbPath(path);
  } catch (err) {
    if (err instanceof ValidationError && opts.db === undefined && fromEnv !== undefined) {
      throw new ValidationError(`RW_DB_PATH=${fromEnv}: ${err.message}`);
    }
    throw err;
  }
}

async function withDb<T>(
  opts: { db?: string },
  fn: (db: DB) => Promise<T>,
  { create = false }: { create?: boolean } = {}
): Promise<T> {
  const dbPath = resolveDbPath(opts);
  // Only commands that add data create the database: a mistyped --db for
  // e.g. project list used to leave a new empty database behind
  if (!create && dbPath !== ":memory:" && !existsSync(dbPath)) {
    console.error(`Database ${dbPath} does not exist. Create a project first (rw project create <name>), or check --db / RW_DB_PATH.`);
    process.exit(1);
  }
  warnIfNoVolume(dbPath);
  const db = await DB.open(dbPath);
  try {
    await migrate(db);
    return await fn(db);
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  } finally {
    await db.close();
  }
}

// Fall back to the "project" field of the nearest .rewelo.json when --project
// is omitted, matching the MCP server's behaviour.
function resolveProjectName(projectName: string | undefined): string {
  // An explicit but blank --project is a mistake, not a request for the default
  if (projectName !== undefined && projectName.trim() === "") {
    console.error("--project must not be empty");
    process.exit(1);
  }
  const name = projectName ?? loadConfig().project;
  if (!name) {
    console.error(
      'No project specified. Pass --project or add a .rewelo.json with a "project" field.'
    );
    process.exit(1);
  }
  return name;
}

async function withProject<T>(
  opts: { db?: string },
  projectName: string | undefined,
  fn: (db: DB, project: Project) => Promise<T>
): Promise<T> {
  const name = resolveProjectName(projectName);
  return withDb(opts, async (db) => {
    const project = await getProjectByName(db, name);
    if (!project) {
      console.error(`Project "${name}" not found`);
      process.exit(1);
    }
    return fn(db, project);
  });
}

// File access on paths the user gave: errors name the path and the problem
function writeFileSync(path: string, data: string, encoding: "utf-8"): void {
  try {
    fsWriteFileSync(path, data, encoding);
  } catch (err) {
    throw describeFsError(err, "write", path);
  }
}

function readFileSync(path: string, encoding: "utf-8"): string {
  try {
    return fsReadFileSync(path, encoding);
  } catch (err) {
    throw describeFsError(err, "read", path);
  }
}

// Check an import file's size before reading it: reading first took about
// 7 GB of memory for a 3 GB file before the 50 MB limit was even checked
function readImportFile(path: string, maxBytes: number): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch (err) {
    throw describeFsError(err, "read", path);
  }
  if (size > maxBytes) {
    throw new ValidationError(`${path} is ${(size / 1024 / 1024).toFixed(1)} MB; imports take at most ${maxBytes / 1024 / 1024} MB`);
  }
  return readFileSync(path, "utf-8");
}

// Confirmation for a command that wrote a file: JSON with the path under
// --json, nothing under --quiet
function reportWritten(opts: { json?: boolean; quiet?: boolean }, path: string, message: string): void {
  if (opts.json) console.log(JSON.stringify({ output: path }));
  else if (!opts.quiet) console.log(message);
}

function formatTable(headers: string[], rows: unknown[][]): string {
  // Coerce every cell to a string up front: some rows carry non-string values
  // (numbers, nulls), and calling String methods like padEnd on them would throw.
  const cells = rows.map((r) =>
    r.map((c) => (c == null ? "" : c instanceof Date ? c.toISOString() : String(c)))
  );
  // --csv applies to every table
  if (program.opts().csv) return [headers, ...cells].map(csvRow).join("\n");
  const widths = headers.map((h, i) =>
    cells.reduce((max, r) => Math.max(max, displayWidth(r[i] || "")), displayWidth(h))
  );
  // Right-align columns whose cells are all numbers (output-formatting.feature)
  const numeric = headers.map((_, i) => cells.length > 0 && cells.every((r) => /^-?\d+(\.\d+)?$/.test(r[i] ?? "")));
  const pad = (text: string, i: number) => {
    const fill = " ".repeat(Math.max(0, widths[i] - displayWidth(text)));
    // No trailing spaces after a left-aligned last column
    return numeric[i] ? fill + text : i === widths.length - 1 ? text : text + fill;
  };
  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const head = headers.map(pad).join(" | ");
  const body = cells.map((r) => r.map(pad).join(" | ")).join("\n");
  return `${head}\n${sep}\n${body}`;
}

// Commander invokes an option's coercion callback as fn(value, previousValue),
// so passing bare `parseInt` makes the option's default value act as the radix
// (e.g. `--top 12` with default 5 => parseInt("12", 5) === 7). Always parse
// base 10 and reject non-integers.
function parseIntOption(value: string): number {
  // The whole value must be an integer: parseInt alone reads "1.5" as 1
  // and "3abc" as 3.
  const n = /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n)) {
    throw new ValidationError(`"${value}" is not a valid integer`);
  }
  return n;
}

// For count-like options (limit/offset/top) a negative value is nonsensical
// and previously produced confusing results (e.g. `--limit -3` sliced from the
// end, showing "2 of 5").
function parseNonNegativeIntOption(value: string): number {
  const n = parseIntOption(value);
  if (n < 0) {
    throw new ValidationError(`"${value}" must be 0 or greater`);
  }
  return n;
}

// Scores must be exact integers. `parseInt` would silently accept lossy input
// (8.5 -> 8, "13xyz" -> 13, "0x8" -> 8) before Fibonacci validation ever ran,
// so validate the raw string is a plain integer first.
function parseScoreOption(value: string): number {
  // Written as CSV import requires: plain digits, no sign, no leading zeros
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new ValidationError(`Score "${value}" must be a whole number without sign or leading zeros`);
  }
  return parseInt(value, 10);
}

// `parseFloat` returns NaN for non-numeric input, which then flows silently
// into weight/threshold calculations (producing NaN output or zero results).
// Require a finite number instead.
function parseFloatOption(value: string): number {
  // The whole value must be a plain decimal: parseFloat reads "2abc" as 2,
  // and Number accepts "0x10" (16) and "1e2"
  const n = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    throw new ValidationError(`"${value}" is not a valid number`);
  }
  return n;
}

// Output piped into e.g. `head` may be closed early: stop quietly, as other
// command-line tools do, instead of crashing with an unhandled EPIPE (or
// ENOTCONN when stdout is a socket, as for child processes Node spawns)
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE" || err.code === "ENOTCONN") process.exit(0);
  throw err;
});

// For single-value options: commander keeps the last of repeated values
// (--w1 1 --w1 2 silently used 2); refuse the repetition instead
function once<T>(parse: (value: string) => T): (value: string, previous: T | undefined) => T {
  return (value, previous) => {
    if (previous !== undefined) throw new InvalidArgumentError("the option was already given");
    return parse(value);
  };
}

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

// =============================================================================
//  PROJECT COMMANDS
// =============================================================================

const projectCmd = program.command("project").description("manage projects");

projectCmd
  .command("create <name>")
  .description("create a new project")
  .action(async (name: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validName = validateProjectName(name);
    await withDb(opts, async (db) => {
      const project = await createProject(db, validName);
      if (opts.json) {
        console.log(JSON.stringify(project));
      } else if (opts.quiet) {
        console.log(project.project_uuid);
      } else {
        console.log(`Created project "${project.name}" (${project.project_uuid})`);
      }
    }, { create: true });
  });

projectCmd
  .command("list")
  .description("list all projects")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const projects = await listProjects(db);
      if (opts.json) {
        console.log(JSON.stringify(projects));
      } else if (opts.quiet) {
        projects.forEach((p) => console.log(p.name));
      } else if (projects.length === 0 && !opts.csv) {
        console.log("No projects found.");
      } else {
        console.log(
          formatTable(
            ["Name", "UUID", "Created"],
            projects.map((p) => [p.name, p.project_uuid, p.created_at])
          )
        );
      }
    });
  });

projectCmd
  .command("delete <name>")
  .description("delete a project and all its data")
  .option("--force", "skip confirmation")
  .action(async (name: string, cmdOpts: { force?: boolean }, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    // Check before asking: confirming the deletion of a missing project is pointless
    const exists = await withDb(opts, async (db) => (await getProjectByName(db, name)) !== undefined);
    if (!exists) {
      console.error(`Project "${name}" not found`);
      process.exit(1);
    }
    if (!cmdOpts.force) {
      if (!process.stdin.isTTY) {
        console.error(`Refusing to delete project "${name}" without confirmation: pass --force when not running interactively`);
        process.exit(1);
      }
      const readline = await import("readline");
      // The prompt goes to stderr so it doesn't mix with --json output
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise<string | { interrupted: number }>((res) => {
        rl.question(`Delete project "${name}" and all its data? (y/N) `, res);
        rl.on("SIGINT", () => res({ interrupted: 130 })); // Ctrl-C
        rl.on("close", () => res({ interrupted: 1 })); // Ctrl-D, no answer
      });
      rl.close();
      if (typeof answer !== "string") {
        // Fail, so `rw project delete X && ...` stops here
        console.error("\nAborted.");
        process.exit(answer.interrupted);
      }
      if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
        console.error("Aborted.");
        return;
      }
    }
    await withDb(opts, async (db) => {
      const deleted = await deleteProject(db, name);
      if (deleted) {
        if (opts.json) console.log(JSON.stringify({ deleted: true, name }));
        else if (!opts.quiet) console.log(`Deleted project "${name}"`);
      } else {
        console.error(`Project "${name}" not found`);
        process.exit(1);
      }
    });
  });

projectCmd
  .command("history")
  .description("show revision history across all tickets in a project")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--since <timestamp>", "only show revisions after this ISO timestamp")
  .option("--limit <n>", "maximum number of revisions", parseNonNegativeIntOption)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const revisions = await listProjectRevisions(db, project.id, cmdOpts.since, cmdOpts.limit);
      if (opts.json) {
        console.log(JSON.stringify(revisions));
      } else if (opts.quiet) {
        revisions.forEach((r) => console.log(`${r.revised_at}\t${r.ticket_title}`));
      } else if (revisions.length === 0 && !opts.csv) {
        // --limit 0 shows nothing, which is not the same as having nothing
        console.log(cmdOpts.limit === 0 ? "No revisions shown (--limit 0)." : "No revisions found.");
      } else {
        console.log(
          formatTable(
            ["Ticket", "Title (at revision)", "B", "P", "E", "R", "Revised At"],
            revisions.map((r) => [
              r.ticket_title, r.title, String(r.benefit), String(r.penalty),
              String(r.estimate), String(r.risk), r.revised_at,
            ])
          )
        );
      }
    });
  });

projectCmd
  .command("diff")
  .description("compare project state against a point in time")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--since <timestamp>", "ISO timestamp to diff from")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const diff = await getProjectDiff(db, project.id, cmdOpts.since);
      // One row per change for --csv and --quiet
      const changes: string[][] = [
        ...diff.newTickets.map((t) => ["new", t.title, t.priority.toFixed(2)]),
        ...diff.updatedTickets.flatMap((t) => t.changes.map((c) => ["updated", t.title, `${c.field}: ${c.from} → ${c.to}`])),
        ...diff.deletedTickets.map((t) => ["deleted", t.title, ""]),
        ...diff.tagChanges.flatMap((t) => [
          ...t.added.map((tag) => ["tag_added", t.ticketTitle, tag]),
          ...t.removed.map((tag) => ["tag_removed", t.ticketTitle, tag]),
        ]),
      ];
      if (opts.json) {
        console.log(JSON.stringify(diff));
      } else if (opts.csv) {
        console.log(formatTable(["Change", "Ticket", "Detail"], changes));
      } else if (opts.quiet) {
        changes.forEach((c) => console.log(c.join("\t")));
      } else {
        if (diff.newTickets.length > 0) {
          console.log(`New tickets (${diff.newTickets.length}):`);
          diff.newTickets.forEach((t: any) => console.log(`  + ${t.title} (priority: ${t.priority})`));
        }
        if (diff.updatedTickets.length > 0) {
          console.log(`Updated tickets (${diff.updatedTickets.length}):`);
          diff.updatedTickets.forEach((t: any) => {
            console.log(`  ~ ${t.title}`);
            t.changes.forEach((c: any) => console.log(`    ${c.field}: ${c.from} → ${c.to}`));
          });
        }
        if (diff.deletedTickets.length > 0) {
          console.log(`Deleted tickets (${diff.deletedTickets.length}):`);
          diff.deletedTickets.forEach((t) => console.log(`  - ${t.title}`));
        }
        if (diff.tagChanges.length > 0) {
          console.log(`Tag changes (${diff.tagChanges.length}):`);
          diff.tagChanges.forEach((t: any) => {
            if (t.added.length > 0) console.log(`  ${t.ticketTitle}: +${t.added.join(", +")}`);
            if (t.removed.length > 0) console.log(`  ${t.ticketTitle}: -${t.removed.join(", -")}`);
          });
        }
        if (
          diff.newTickets.length === 0 && diff.updatedTickets.length === 0 &&
          diff.deletedTickets.length === 0 && diff.tagChanges.length === 0
        ) {
          console.log("No changes since " + cmdOpts.since);
        }
      }
    });
  });

// =============================================================================
//  TICKET COMMANDS
// =============================================================================

const ticketCmd = program.command("ticket").description("manage tickets");

ticketCmd
  .command("create")
  .description("create a new ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--title <title>", "ticket title")
  .option("--description <text>", "ticket description")
  .option("--benefit <n>", "benefit score (Fibonacci)", parseScoreOption)
  .option("--penalty <n>", "penalty score (Fibonacci)", parseScoreOption)
  .option("--estimate <n>", "estimate score (Fibonacci)", parseScoreOption)
  .option("--risk <n>", "risk score (Fibonacci)", parseScoreOption)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validTitle = validateTicketTitle(cmdOpts.title);
    const validDesc = validateTicketDescription(cmdOpts.description);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await createTicket(db, {
        projectId: project.id,
        title: validTitle,
        description: validDesc,
        benefit: cmdOpts.benefit,
        penalty: cmdOpts.penalty,
        estimate: cmdOpts.estimate,
        risk: cmdOpts.risk,
      });
      if (opts.json) {
        console.log(JSON.stringify(ticket));
      } else if (opts.quiet) {
        console.log(ticket.ticket_uuid);
      } else {
        console.log(
          `Created ticket "${ticket.title}" (${ticket.ticket_uuid}) [B:${ticket.benefit} P:${ticket.penalty} E:${ticket.estimate} R:${ticket.risk}]`
        );
      }
    });
  });

ticketCmd
  .command("list")
  .description("list tickets in a project")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--tag <prefix:value>", "filter by tag (repeatable, intersection)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--exclude-tag <prefix:value>", "exclude tickets with tag (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--search <text>", "filter by title substring (case-insensitive)")
  .option("--sort <field>", "sort by: priority, value, cost, benefit, penalty, estimate, risk")
  .option("--limit <n>", "max number of results", parseNonNegativeIntOption)
  .option("--offset <n>", "skip first N results", parseNonNegativeIntOption, 0)
  .option("--min-priority <n>", "minimum priority threshold", parseFloatOption)
  .option("--min-value <n>", "minimum value (benefit+penalty) threshold", parseFloatOption)
  .option("--max-cost <n>", "maximum cost (estimate+risk) threshold", parseFloatOption)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      // Build tag filter arrays
      const includeTags = (cmdOpts.tag as string[]).map((s: string) => parseTag(s));
      const excludeTagPairs = (cmdOpts.excludeTag as string[]).map((s: string) => parseTag(s));

      const tickets = await listTickets(db, project.id, {
        includeTags: includeTags.length > 0 ? includeTags : undefined,
        excludeTags: excludeTagPairs.length > 0 ? excludeTagPairs : undefined,
        search: cmdOpts.search,
      });

      const enriched = tickets.map((t) => ({
        ...t,
        value: t.benefit + t.penalty,
        cost: t.estimate + t.risk,
        priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
      }));

      // Score threshold filters
      let filtered = enriched;
      if (cmdOpts.minPriority != null) filtered = filtered.filter((t) => exactPriority(t.benefit, t.penalty, t.estimate, t.risk) >= cmdOpts.minPriority);
      if (cmdOpts.minValue != null) filtered = filtered.filter((t) => t.value >= cmdOpts.minValue);
      if (cmdOpts.maxCost != null) filtered = filtered.filter((t) => t.cost <= cmdOpts.maxCost);

      if (cmdOpts.sort !== undefined) {
        const validSortFields = ["priority", "value", "cost", "benefit", "penalty", "estimate", "risk"];
        if (!validSortFields.includes(cmdOpts.sort)) {
          throw new ValidationError(
            `Invalid sort field "${cmdOpts.sort}". Valid fields: ${validSortFields.join(", ")}`
          );
        }
        const key = cmdOpts.sort as keyof (typeof filtered)[0];
        filtered.sort(key === "priority" ? byPriority : (a, b) => (b[key] as number) - (a[key] as number));
      }

      // Pagination
      const total = filtered.length;
      const offset = cmdOpts.offset || 0;
      if (offset > 0) filtered = filtered.slice(offset);
      if (cmdOpts.limit != null) filtered = filtered.slice(0, cmdOpts.limit);

      if (opts.json) {
        console.log(JSON.stringify({ total, offset, items: filtered }));
      } else if (opts.quiet) {
        filtered.forEach((t) => console.log(t.title));
      } else if (opts.csv) {
        console.log(csvRow(["title", "benefit", "penalty", "estimate", "risk", "value", "cost", "priority"]));
        filtered.forEach((t) =>
          console.log(csvRow([
            t.title, String(t.benefit), String(t.penalty), String(t.estimate),
            String(t.risk), String(t.value), String(t.cost), t.priority.toFixed(2),
          ]))
        );
      } else if (filtered.length === 0) {
        // An offset past the end is not the same as no matching tickets
        console.log(total > 0 ? `Showing 0 of ${total} tickets` : "No tickets found.");
      } else {
        if (total > filtered.length) console.log(`Showing ${filtered.length} of ${total} tickets\n`);
        console.log(
          formatTable(
            ["Title", "B", "P", "E", "R", "Value", "Cost", "Priority"],
            filtered.map((t) => [
              t.title, String(t.benefit), String(t.penalty), String(t.estimate),
              String(t.risk), String(t.value), String(t.cost), t.priority.toFixed(2),
            ])
          )
        );
      }
    });
  });

ticketCmd
  .command("update")
  .description("update a ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--title <title>", "ticket to update (by current title)")
  .option("--new-title <title>", "new title")
  .option("--description <text>", "new description")
  .option("--benefit <n>", "benefit score", parseScoreOption)
  .option("--penalty <n>", "penalty score", parseScoreOption)
  .option("--estimate <n>", "estimate score", parseScoreOption)
  .option("--risk <n>", "risk score", parseScoreOption)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validNewTitle = cmdOpts.newTitle !== undefined ? validateTicketTitle(cmdOpts.newTitle) : undefined;
    const validDesc = validateTicketDescription(cmdOpts.description);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.title);
      if (!ticket) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      const updated = await updateTicket(db, project.id, ticket.id, {
        title: validNewTitle,
        description: validDesc,
        benefit: cmdOpts.benefit,
        penalty: cmdOpts.penalty,
        estimate: cmdOpts.estimate,
        risk: cmdOpts.risk,
      });
      const changed =
        updated.title !== ticket.title ||
        updated.description !== ticket.description ||
        updated.benefit !== ticket.benefit ||
        updated.penalty !== ticket.penalty ||
        updated.estimate !== ticket.estimate ||
        updated.risk !== ticket.risk;
      if (opts.json) {
        console.log(JSON.stringify(updated));
      } else if (opts.quiet) {
        // nothing to report
      } else if (!changed) {
        console.log(`No changes to "${updated.title}"`);
      } else {
        console.log(`Updated "${updated.title}" [B:${updated.benefit} P:${updated.penalty} E:${updated.estimate} R:${updated.risk}]`);
      }
    });
  });

ticketCmd
  .command("delete")
  .description("delete a ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--title <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.title);
      if (!ticket) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      // Another process may have deleted it since the lookup
      if (!(await deleteTicket(db, project.id, ticket.id))) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      if (opts.json) console.log(JSON.stringify({ deleted: true, title: ticket.title }));
      else if (!opts.quiet) console.log(`Deleted ticket "${ticket.title}"`);
    });
  });

ticketCmd
  .command("history")
  .description("show revision history for a ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--title <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.title);
      if (!ticket) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      const revisions = await listRevisions(db, ticket.id);
      if (opts.json) {
        console.log(JSON.stringify(revisions));
      } else if (opts.quiet) {
        revisions.forEach((r) => console.log(r.revised_at));
      } else if (revisions.length === 0 && !opts.csv) {
        console.log("No revisions found.");
      } else {
        console.log(
          formatTable(
            ["#", "Title", "B", "P", "E", "R", "Tags", "Revised At"],
            revisions.map((r, i) => [
              String(i + 1), r.title, String(r.benefit), String(r.penalty),
              String(r.estimate), String(r.risk),
              Array.isArray(r.tags) ? r.tags.map((t) => `${t.prefix}:${t.value}`).join(", ") : String(r.tags),
              r.revised_at,
            ])
          )
        );
      }
    });
  });

ticketCmd
  .command("upsert")
  .description("create a ticket if it does not exist, or update it if it does (matched by title)")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--title <title>", "ticket title (used as unique key)")
  .option("--description <text>", "ticket description")
  .option("--benefit <n>", "benefit score (Fibonacci)", parseScoreOption)
  .option("--penalty <n>", "penalty score (Fibonacci)", parseScoreOption)
  .option("--estimate <n>", "estimate score (Fibonacci)", parseScoreOption)
  .option("--risk <n>", "risk score (Fibonacci)", parseScoreOption)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validTitle = validateTicketTitle(cmdOpts.title);
    const validDesc = validateTicketDescription(cmdOpts.description);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const result = await upsertTicket(db, project.id, validTitle, {
        description: validDesc,
        benefit: cmdOpts.benefit,
        penalty: cmdOpts.penalty,
        estimate: cmdOpts.estimate,
        risk: cmdOpts.risk,
      });
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (opts.quiet) {
        console.log(result.ticket.ticket_uuid);
      } else {
        const t = result.ticket;
        if (result.action === "unchanged") {
          console.log(`No changes to "${t.title}"`);
        } else {
          console.log(
            `${result.action === "created" ? "Created" : "Updated"} ticket "${t.title}" (${t.ticket_uuid}) [B:${t.benefit} P:${t.penalty} E:${t.estimate} R:${t.risk}]`
          );
        }
      }
    });
  });

// =============================================================================
//  TAG COMMANDS
// =============================================================================

const tagCmd = program.command("tag").description("manage tags");

tagCmd
  .command("create <tag>")
  .description("create a tag (format: prefix:value)")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (tagStr: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const { prefix: rawPrefix, value: rawValue } = parseTagPair(tagStr);
    const prefix = validateTagPrefix(rawPrefix);
    const value = validateTagValue(rawValue);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const tag = await createTag(db, project.id, prefix, value);
      if (opts.json) console.log(JSON.stringify(tag));
      else if (!opts.quiet) console.log(`Created tag "${prefix}:${value}"`);
    });
  });

tagCmd
  .command("assign <tags...>")
  .description("assign one or more tags to one or more tickets")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--ticket <title>", "ticket title (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .action(async (tagStrs: string[], cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const tickets: string[] = cmdOpts.ticket;
    if (tickets.length === 0) { console.error("At least one --ticket is required"); process.exit(1); }
    // The same tag or ticket named twice (possibly spelt differently) is
    // applied and reported once
    const parsedTags = [...new Map(tagStrs.map((s: string) => {
      const tag = parseTag(s);
      return [`${tag.prefix}:${tag.value}`, tag] as const;
    })).values()];
    assertOneValuePerPrefix(parsedTags);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      // Resolve every target ticket up front so a missing one aborts before
      // any tag is applied, rather than partially assigning and then failing.
      const resolved: { title: string; id: number }[] = [];
      for (const ticketTitle of tickets) {
        const ticket = await getTicketByTitle(db, project.id, ticketTitle);
        if (!ticket) { console.error(`Ticket "${ticketTitle}" not found`); process.exit(1); }
        if (!resolved.some((r) => r.id === ticket.id)) resolved.push({ title: ticket.title, id: ticket.id });
      }
      const results: { ticket: string; tag: string; status: string; replaced?: string[] }[] = [];
      // All or nothing, and no other process creating the same tag in between
      await db.transaction(async () => {
        for (const { title: ticketTitle, id } of resolved) {
          for (const t of parsedTags) {
            let tag = await getTag(db, project.id, t.prefix, t.value);
            if (!tag) tag = await createTag(db, project.id, t.prefix, t.value);
            const { assigned, replaced } = await assignTag(db, id, tag.id);
            results.push({
              ticket: ticketTitle,
              tag: `${t.prefix}:${t.value}`,
              status: assigned ? "assigned" : "already_assigned",
              ...(replaced.length > 0 ? { replaced } : {}),
            });
          }
        }
      });
      if (opts.json) console.log(JSON.stringify(results));
      else if (!opts.quiet) {
        for (const r of results) {
          const note = r.replaced ? ` (replaced ${r.replaced.map((x) => `"${x}"`).join(", ")})` : "";
          console.log(r.status === "assigned" ? `Assigned "${r.tag}" to "${r.ticket}"${note}` : `Tag "${r.tag}" already assigned to "${r.ticket}"`);
        }
      }
    });
  });

tagCmd
  .command("remove <tag>")
  .description("remove a tag from a ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--ticket <title>", "ticket title")
  .action(async (tagStr: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const { prefix: rawPrefix, value: rawValue } = parseTagPair(tagStr);
    const prefix = validateTagPrefix(rawPrefix);
    const value = validateTagValue(rawValue);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.ticket);
      if (!ticket) { console.error(`Ticket "${cmdOpts.ticket}" not found`); process.exit(1); }
      const tag = await getTag(db, project.id, prefix, value);
      if (!tag) { console.error(`Tag "${prefix}:${value}" not found`); process.exit(1); }
      const removed = await removeTag(db, ticket.id, tag.id);
      if (opts.json) console.log(JSON.stringify({ ticket: ticket.title, tag: `${prefix}:${value}`, status: removed ? "removed" : "was_not_assigned" }));
      else if (!opts.quiet) console.log(removed ? `Removed "${prefix}:${value}" from "${ticket.title}"` : `Tag "${prefix}:${value}" was not assigned`);
    });
  });

tagCmd
  .command("list")
  .description("list all tags in a project")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const tags = await listTags(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(tags));
      } else if (opts.csv) {
        console.log([["prefix", "value"], ...tags.map((t) => [t.prefix, t.value])].map(csvRow).join("\n"));
      } else if (opts.quiet) {
        tags.forEach((t) => console.log(`${t.prefix}:${t.value}`));
      } else if (tags.length === 0) {
        console.log("No tags found.");
      } else {
        let currentPrefix = "";
        for (const tag of tags) {
          if (tag.prefix !== currentPrefix) {
            // A blank line between prefixes, not before the first
            console.log(`${currentPrefix === "" ? "" : "\n"}${tag.prefix}:`);
            currentPrefix = tag.prefix;
          }
          console.log(`  ${tag.value}`);
        }
      }
    });
  });

tagCmd
  .command("delete <tag>")
  .description("delete a tag that no ticket holds")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (tagStr: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const { prefix, value } = parseTag(tagStr);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const tag = await getTag(db, project.id, prefix, value);
      if (!tag) { console.error(`Tag "${prefix}:${value}" not found`); process.exit(1); }
      await deleteTag(db, project.id, tag.id);
      if (opts.json) console.log(JSON.stringify({ deleted: true, tag: `${prefix}:${value}` }));
      else if (!opts.quiet) console.log(`Deleted tag "${prefix}:${value}"`);
    });
  });

tagCmd
  .command("rename")
  .description("rename a tag value")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--prefix <prefix>", "tag prefix")
  .requiredOption("--old <value>", "current tag value")
  .requiredOption("--new <value>", "new tag value")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const prefix = validateTagPrefix(cmdOpts.prefix);
    const oldValue = validateTagValue(cmdOpts.old);
    const newValue = validateTagValue(cmdOpts.new);
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const tag = await getTag(db, project.id, prefix, oldValue);
      if (!tag) {
        console.error(`Tag "${prefix}:${oldValue}" not found`);
        process.exit(1);
      }
      const renamed = await renameTag(db, project.id, tag.id, prefix, newValue);
      if (opts.json) {
        console.log(JSON.stringify(renamed));
      } else if (opts.quiet) {
        // nothing to report
      } else if (oldValue === newValue) {
        console.log(`No changes to "${prefix}:${oldValue}"`);
      } else {
        console.log(`Renamed "${prefix}:${oldValue}" to "${prefix}:${newValue}"`);
      }
    });
  });

tagCmd
  .command("log")
  .description("show tag change log for a ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--ticket <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.ticket);
      if (!ticket) { console.error(`Ticket "${cmdOpts.ticket}" not found`); process.exit(1); }
      const log = await getTagChangeLog(db, ticket.id);
      if (opts.json) {
        console.log(JSON.stringify(log));
      } else if (opts.quiet) {
        log.forEach((e) => console.log(`${e.action}\t${e.prefix}:${e.value}`));
      } else if (log.length === 0 && !opts.csv) {
        console.log("No tag changes recorded.");
      } else {
        console.log(
          formatTable(
            ["Action", "Tag", "Changed At"],
            log.map((e) => [e.action, `${e.prefix}:${e.value}`, e.changed_at])
          )
        );
      }
    });
  });

// =============================================================================
//  RELATION COMMANDS
// =============================================================================

const relationCmd = program.command("relation").description("manage ticket relations");

relationCmd
  .command("create")
  .description("create a relation between two tickets")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--source <title>", "source ticket title")
  .requiredOption("--type <type>", "relation type (e.g. blocks, depends-on, relates-to)")
  .requiredOption("--target <title>", "target ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const source = await getTicketByTitle(db, project.id, cmdOpts.source);
      if (!source) { console.error(`Ticket "${cmdOpts.source}" not found`); process.exit(1); }
      const target = await getTicketByTitle(db, project.id, cmdOpts.target);
      if (!target) { console.error(`Ticket "${cmdOpts.target}" not found`); process.exit(1); }
      const relation = await createRelation(db, project.id, source.id, target.id, cmdOpts.type);
      if (opts.json) {
        console.log(JSON.stringify(relation));
      } else if (!opts.quiet) {
        console.log(`Created: "${source.title}" ${normalizeRelationType(cmdOpts.type)} "${target.title}"`);
      }
    });
  });

relationCmd
  .command("remove")
  .description("remove a relation between two tickets")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--source <title>", "source ticket title")
  .requiredOption("--type <type>", "relation type")
  .requiredOption("--target <title>", "target ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const source = await getTicketByTitle(db, project.id, cmdOpts.source);
      if (!source) { console.error(`Ticket "${cmdOpts.source}" not found`); process.exit(1); }
      const target = await getTicketByTitle(db, project.id, cmdOpts.target);
      if (!target) { console.error(`Ticket "${cmdOpts.target}" not found`); process.exit(1); }
      await removeRelation(db, project.id, source.id, target.id, cmdOpts.type);
      if (opts.json) {
        console.log(JSON.stringify({ removed: true }));
      } else if (!opts.quiet) {
        console.log(`Removed: "${source.title}" ${normalizeRelationType(cmdOpts.type)} "${target.title}"`);
      }
    });
  });

relationCmd
  .command("list")
  .description("list all relations for a ticket")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--ticket <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.ticket);
      if (!ticket) { console.error(`Ticket "${cmdOpts.ticket}" not found`); process.exit(1); }
      const relations = await listRelations(db, project.id, ticket.id);
      if (opts.json) {
        console.log(JSON.stringify(relations));
      } else if (opts.quiet) {
        relations.forEach((r) => console.log(`${r.relation_type}\t${r.ticket_title}`));
      } else if (relations.length === 0 && !opts.csv) {
        console.log("No relations found.");
      } else {
        console.log(
          formatTable(
            ["Type", "Direction", "Ticket"],
            relations.map((r) => [r.relation_type, r.direction, r.ticket_title])
          )
        );
      }
    });
  });

relationCmd
  .command("list-all")
  .description("list all relations in a project")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const relations = await listProjectRelations(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(relations));
      } else if (opts.quiet) {
        relations.forEach((r) => console.log(`${r.source_title}\t${r.relation_type}\t${r.target_title}`));
      } else if (relations.length === 0 && !opts.csv) {
        console.log("No relations found.");
      } else {
        console.log(
          formatTable(
            ["Source", "Type", "Target"],
            relations.map((r) => [r.source_title, r.relation_type, r.target_title])
          )
        );
      }
    });
  });

// =============================================================================
//  CONFIG COMMANDS
// =============================================================================

const configCmd = program.command("config").description("configuration commands");

configCmd
  .command("weights")
  .description("view or manage weight configuration")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--set", "set the weights given with --w1..--w4 (at least one; the others keep their value)")
  .option("--reset", "reset weights to defaults")
  .option("--w1 <n>", "benefit weight", once(parseFloatOption))
  .option("--w2 <n>", "penalty weight", once(parseFloatOption))
  .option("--w3 <n>", "estimate weight", once(parseFloatOption))
  .option("--w4 <n>", "risk weight", once(parseFloatOption))
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    // Reject combinations that would otherwise be silently ignored
    const givesWeights = ["w1", "w2", "w3", "w4"].some((w) => cmdOpts[w] !== undefined);
    if (cmdOpts.set && cmdOpts.reset) throw new ValidationError("Use either --set or --reset, not both");
    if (cmdOpts.set && !givesWeights) throw new ValidationError("--set needs at least one of --w1, --w2, --w3, --w4");
    if (!cmdOpts.set && givesWeights) {
      throw new ValidationError(cmdOpts.reset ? "Use either --set or --reset, not both" : "Pass --set to change weights");
    }
    await withProject(opts, cmdOpts.project, async (db, project) => {
      if (cmdOpts.reset) {
        const config = await resetWeights(db, project.id);
        if (opts.json) {
          console.log(JSON.stringify(config));
        } else if (!opts.quiet) {
          console.log(`Reset weights for "${project.name}" to defaults: w1=${config.w1} w2=${config.w2} w3=${config.w3} w4=${config.w4}`);
        }
        return;
      }

      if (cmdOpts.set) {
        const current = await getWeights(db, project.id);
        const w1 = cmdOpts.w1 ?? current.w1;
        const w2 = cmdOpts.w2 ?? current.w2;
        const w3 = cmdOpts.w3 ?? current.w3;
        const w4 = cmdOpts.w4 ?? current.w4;
        const config = await setWeights(db, project.id, w1, w2, w3, w4);
        if (opts.json) {
          console.log(JSON.stringify(config));
        } else if (!opts.quiet) {
          console.log(`Set weights for "${project.name}": w1=${config.w1} w2=${config.w2} w3=${config.w3} w4=${config.w4}`);
        }
        return;
      }

      // Default: view
      const config = await getWeights(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(config));
      } else if (opts.csv) {
        console.log(formatTable(["w1", "w2", "w3", "w4"], [[config.w1, config.w2, config.w3, config.w4]]));
      } else if (opts.quiet) {
        console.log([config.w1, config.w2, config.w3, config.w4].join("\t"));
      } else {
        console.log(`Weights for "${project.name}": w1=${config.w1} w2=${config.w2} w3=${config.w3} w4=${config.w4}`);
      }
    });
  });

// =============================================================================
//  CALC COMMANDS
// =============================================================================

const calcCmd = program.command("calc").description("calculation commands");

calcCmd
  .command("weights")
  .description("show relative weights for tickets")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--tag <prefix:value>", "scope to tickets with this tag (repeatable, intersection)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      // Several --tag options narrow the scope together, as in ticket list
      const includeTags = (cmdOpts.tag as string[]).map((s) => parseTag(s));
      const tickets = await listTickets(db, project.id, includeTags.length > 0 ? { includeTags } : undefined);

      const results = calculateAllRelativeWeights(tickets).map((t) => ({
        title: t.title,
        relativeBenefit: t.relativeBenefit,
        relativePenalty: t.relativePenalty,
        relativeEstimate: t.relativeEstimate,
        relativeRisk: t.relativeRisk,
      }));

      // Two decimals, without claiming a non-zero share is 0
      // round2 rounds halves up (0.075 -> 0.08); toFixed alone gave 0.07
      // CSV is for machines: the full value, never "<0.01"
      const share = (x: number) =>
        opts.csv ? String(x) : x > 0 && x < 0.005 ? "<0.01" : round2(x).toFixed(2);
      if (opts.json) {
        console.log(JSON.stringify(results));
      } else if (opts.quiet) {
        results.forEach((r) => console.log([r.title, r.relativeBenefit, r.relativePenalty, r.relativeEstimate, r.relativeRisk].join("\t")));
      } else if (results.length === 0 && !opts.csv) {
        console.log("No tickets found.");
      } else {
        console.log(
          formatTable(
            ["Title", "Rel.Benefit", "Rel.Penalty", "Rel.Estimate", "Rel.Risk"],
            results.map((r) => [
              r.title, share(r.relativeBenefit), share(r.relativePenalty),
              share(r.relativeEstimate), share(r.relativeRisk),
            ])
          )
        );
      }
    });
  });

calcCmd
  .command("priority")
  .description("show weighted priorities")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--tag <prefix:value>", "only tickets with this tag (repeatable, intersection)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--w1 <n>", "benefit weight", once(parseFloatOption))
  .option("--w2 <n>", "penalty weight", once(parseFloatOption))
  .option("--w3 <n>", "estimate weight", once(parseFloatOption))
  .option("--w4 <n>", "risk weight", once(parseFloatOption))
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const includeTags = (cmdOpts.tag as string[]).map((s) => parseTag(s));
      const tickets = await listTickets(db, project.id, includeTags.length > 0 ? { includeTags } : undefined);
      const config = await getWeights(db, project.id);
      const w1 = cmdOpts.w1 ?? config.w1;
      const w2 = cmdOpts.w2 ?? config.w2;
      const w3 = cmdOpts.w3 ?? config.w3;
      const w4 = cmdOpts.w4 ?? config.w4;
      validateWeights(w1, w2, w3, w4);

      // Sort on the unrounded weighted priority; display the rounded one
      const exact = (t: (typeof tickets)[0]) => exactWeightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4);
      const results = [...tickets].sort((a, b) => exact(b) - exact(a)).map((t) => ({
        title: t.title,
        priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
        weighted: weightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4),
      }));

      if (opts.json) {
        console.log(JSON.stringify(results));
      } else if (opts.quiet) {
        results.forEach((r) => console.log(`${r.title}\t${r.weighted.toFixed(2)}`));
      } else if (results.length === 0 && !opts.csv) {
        console.log("No tickets found.");
      } else {
        if (!opts.csv) console.log(`Weights: w1=${w1} w2=${w2} w3=${w3} w4=${w4}\n`);
        console.log(
          formatTable(
            ["Title", "Priority", "Weighted"],
            results.map((r) => [r.title, r.priority.toFixed(2), r.weighted.toFixed(2)])
          )
        );
      }
    });
  });

// =============================================================================
//  EXPORT COMMANDS
// =============================================================================

const exportCmd = program.command("export").description("export project data");

exportCmd
  .command("csv")
  .description("export tickets as CSV")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--output <path>", "output file path")
  .option("--with-calculations", "include value, cost, priority columns")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const csv = await exportCsv(db, project.id, {
        withCalculations: cmdOpts.withCalculations,
      });
      if (cmdOpts.output) {
        const outPath = validateExportPath(cmdOpts.output, [".csv"]);
        writeFileSync(outPath, csv, "utf-8");
        reportWritten(opts, outPath, `Exported to ${outPath}`);
      } else {
        process.stdout.write(csv);
      }
    });
  });

exportCmd
  .command("json")
  .description("export project data as JSON")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--output <path>", "output file path")
  .option("--with-history", "include revisions and tag change log")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const data = await exportJson(db, project.id, {
        withHistory: cmdOpts.withHistory,
      });
      const output = JSON.stringify(data, null, 2);
      if (cmdOpts.output) {
        const outPath = validateExportPath(cmdOpts.output, [".json"]);
        writeFileSync(outPath, output, "utf-8");
        reportWritten(opts, outPath, `Exported to ${outPath}`);
      } else {
        console.log(output);
      }
    });
  });

// =============================================================================
//  IMPORT COMMANDS
// =============================================================================

const importCmd = program.command("import").description("import project data");

importCmd
  .command("csv <file>")
  .description("import tickets from CSV")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (file: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const csv = readImportFile(validateImportPath(file, [".csv"]), MAX_CSV_BYTES);
      const result = await importCsv(db, project.id, csv);
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (!opts.quiet) {
        console.log(`Imported ${result.imported} ticket${result.imported === 1 ? "" : "s"}`);
      }
    });
  });

importCmd
  .command("json <file>")
  .description("import project data from JSON (creates the project if needed)")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (file: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const name = resolveProjectName(cmdOpts.project);
    await withDb(opts, async (db) => {
      const json = readImportFile(validateImportPath(file, [".json"]), MAX_JSON_SIZE_BYTES);
      const result = await importJsonAsProject(db, name, json);
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (!opts.quiet) {
        if (result.projectCreated) console.log(`Created project "${name}"`);
        console.log(`Imported ${result.imported} ticket${result.imported === 1 ? "" : "s"}`);
      }
    }, { create: true });
  });

// =============================================================================
//  REPORT COMMANDS
// =============================================================================

const reportCmd = program.command("report").description("reporting commands");

reportCmd
  .command("summary")
  .description("project summary with top-N by priority")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--top <n>", "number of top tickets to show", parseNonNegativeIntOption, 5)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const summary = await getProjectSummary(db, project.id, cmdOpts.top);
      // Section, name, value rows for --csv and --quiet
      const rows: unknown[][] = [
        ["total", "", summary.totalTickets],
        ...Object.entries(summary.byState).map(([state, count]) => ["state", state, count]),
        ...(summary.withoutState > 0 ? [["state", "", summary.withoutState]] : []),
        ...summary.topByPriority.map((t) => ["top", t.title, t.priority.toFixed(2)]),
      ];
      if (opts.json) {
        console.log(JSON.stringify(summary));
      } else if (opts.csv) {
        console.log(formatTable(["Section", "Name", "Value"], rows));
      } else if (opts.quiet) {
        rows.forEach((r) => console.log(r.join("\t")));
      } else {
        console.log(`Project: ${project.name}`);
        console.log(`Total tickets: ${summary.totalTickets}`);
        for (const [state, count] of Object.entries(summary.byState)) {
          console.log(`  state:${state}: ${count}`);
        }
        if (summary.withoutState > 0) console.log(`  (no state tag): ${summary.withoutState}`);
        if (summary.topByPriority.length > 0) {
          console.log(`\nTop ${summary.topByPriority.length} open by priority:`);
          summary.topByPriority.forEach((t, i) =>
            console.log(`  ${i + 1}. ${t.title} (${t.priority.toFixed(2)})`)
          );
        }
      }
    });
  });

reportCmd
  .command("group")
  .description("group tickets by tag prefix")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--prefix <prefix>", "tag prefix to group by")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const groups = await groupByTagPrefix(db, project.id, validateTagPrefix(cmdOpts.prefix));
      if (opts.json) {
        console.log(JSON.stringify(groups));
      } else if (opts.quiet) {
        groups.forEach((g) => console.log(`${g.value}\t${g.ticketCount}\t${g.averagePriority.toFixed(2)}`));
      } else if (groups.length === 0 && !opts.csv) {
        console.log(`No tickets with "${cmdOpts.prefix}:" tags found.`);
      } else {
        console.log(
          formatTable(
            ["Value", "Tickets", "Avg Priority"],
            groups.map((g) => [g.value, String(g.ticketCount), g.averagePriority.toFixed(2)])
          )
        );
      }
    });
  });

reportCmd
  .command("distribution")
  .description("Fibonacci score distribution")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const dist = await getDistribution(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(dist));
      } else if (opts.quiet) {
        dist.forEach((d) => console.log([d.dimension, ...[1, 2, 3, 5, 8, 13, 21].map((f) => d.counts[f] || 0)].join("\t")));
      } else if (dist.every((d) => Object.values(d.counts).every((c) => c === 0)) && !opts.csv) {
        console.log("No tickets found.");
      } else {
        const fibs = [1, 2, 3, 5, 8, 13, 21];
        console.log(
          formatTable(
            ["Dimension", ...fibs.map(String)],
            dist.map((d) => [d.dimension, ...fibs.map((f) => String(d.counts[f] || 0))])
          )
        );
      }
    });
  });

reportCmd
  .command("health")
  .description("backlog health report")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--threshold <n>", "high priority threshold", parseFloatOption, 1.5)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const health = await getBacklogHealth(db, project.id, cmdOpts.threshold);
      const metrics: [string, unknown][] = Object.entries(health);
      if (opts.json) {
        console.log(JSON.stringify(health));
      } else if (opts.csv) {
        console.log(formatTable(["Metric", "Value"], metrics));
      } else if (opts.quiet) {
        metrics.forEach(([name, value]) => console.log(`${name}\t${value ?? ""}`));
      } else {
        console.log(`Project: ${project.name}`);
        console.log(`Total: ${health.totalTickets} | Done: ${health.doneTickets} | Open: ${health.openTickets}`);
        console.log(`High priority: ${health.highPriorityCount} | Low priority: ${health.lowPriorityCount}`);
        const ratioText =
          health.highToLowRatio !== null
            ? String(health.highToLowRatio)
            : health.highPriorityCount > 0
            ? "n/a (no low-priority tickets)"
            : "n/a";
        console.log(`High:Low ratio: ${ratioText}`);
        console.log(`Total backlog cost: ${health.totalBacklogCost}`);
      }
    });
  });

reportCmd
  .command("times")
  .description("lead and cycle time report")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const times = await getProjectTimes(db, project.id);
      const avg = averageLeadTime(times);
      if (opts.json) {
        console.log(JSON.stringify(timesReport(times)));
      } else if (opts.quiet) {
        times.forEach((t) => console.log(`${t.ticketTitle}\t${t.leadTimeDays ?? ""}\t${t.cycleTimeDays ?? ""}`));
      } else if (times.length === 0 && !opts.csv) {
        console.log("No tickets found.");
      } else {
        // An empty CSV field, not "-" (which the formula guard turns into '-)
        const none = opts.csv ? "" : "-";
        // Every ticket, as in --json: open ones without times
        const rows = times.map((t) => {
          return [
            t.ticketTitle,
            t.leadTimeDays !== undefined ? `${t.leadTimeDays}d` : none,
            t.cycleTimeDays !== undefined ? `${t.cycleTimeDays}d` : none,
          ];
        });
        console.log(formatTable(["Title", "Lead Time", "Cycle Time"], rows));
        const avgCycle = averageCycleTime(times);
        if (avg === undefined && !opts.csv) console.log("\nNo completed tickets yet.");
        if (avg !== undefined && !opts.csv) console.log(`\nAverage lead time: ${avg}d`);
        if (avgCycle !== undefined && !opts.csv) console.log(`Average cycle time: ${avgCycle}d`);
      }
    });
  });

reportCmd
  .command("event-log")
  .description("unified chronological event stream for a project")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .option("--since <timestamp>", "only events after this ISO timestamp, oldest first")
  .option("--after <sequence>", "only events written after this sequence number, in write order", parseNonNegativeIntOption)
  .option("--limit <n>", "maximum number of events", parseNonNegativeIntOption, 50)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const events = await getEventLog(db, project.id, cmdOpts.since, cmdOpts.limit, cmdOpts.after);
      if (opts.json) {
        console.log(JSON.stringify(events));
      } else if (opts.quiet) {
        events.forEach((e) => console.log(`${e.timestamp}\t${e.type}\t${e.ticketTitle}`));
      } else if (events.length === 0 && !opts.csv) {
        console.log(cmdOpts.limit === 0 ? "No events shown (--limit 0)." : "No events found.");
      } else {
        const detail = (e: (typeof events)[0]) => (typeof e.detail === "object" ? JSON.stringify(e.detail) : String(e.detail));
        if (opts.csv) {
          console.log(formatTable(["Timestamp", "Type", "Ticket", "Detail"], events.map((e) => [e.timestamp, e.type, e.ticketTitle, detail(e)])));
        } else {
          for (const e of events) console.log(`${e.timestamp}  ${e.type.padEnd(16)}  ${e.ticketTitle}  ${detail(e)}`);
        }
      }
    });
  });

reportCmd
  .command("dashboard")
  .description("generate a self-contained HTML dashboard")
  .option("--project <name>", "project name (falls back to .rewelo.json)")
  .requiredOption("--output <path>", "output HTML file path")
  .option("--limit <n>", "rows per table (default 500)", parseNonNegativeIntOption)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withProject(opts, cmdOpts.project, async (db, project) => {
      const html = await renderDashboard(db, project.id, project.name, {
        generatedAt: new Date().toISOString(),
        limit: cmdOpts.limit,
      });
      const outPath = validateExportPath(cmdOpts.output, [".html"]);
      writeFileSync(outPath, html, "utf-8");
      reportWritten(opts, outPath, `Dashboard written to ${outPath}`);
    });
  });

// =============================================================================
//  MCP SERVER COMMAND
// =============================================================================

program
  .command("serve")
  .description("start MCP server (stdio transport)")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const dbPath = resolveDbPath(opts);
    warnIfNoVolume(dbPath);
    // Loaded on demand: the MCP SDK roughly quadruples CLI startup time,
    // and no other command needs it.
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer(dbPath);
  });

program.parseAsync().catch((err) => {
  console.error(sanitizeError(err));
  process.exit(1);
});
