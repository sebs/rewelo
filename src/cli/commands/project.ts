import { Command } from "commander";
import { createProject, deleteProject, getProjectByName, listProjects } from "../../projects/repository.js";
import { listProjectRevisions } from "../../revisions/repository.js";
import { getProjectDiff } from "../../reports/diff.js";
import { AppError } from "../../errors.js";
import { validateProjectName } from "../../validation/strings.js";
import { withDb, withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, parseNonNegativeIntOption, type ProjectOptions } from "../options.js";
import { emptyPage, formatTable, printResult, printRows } from "../output.js";

// Asks on stderr, so the prompt doesn't mix with --json output. Ctrl-C and
// Ctrl-D end the command with a failure, so `rw project delete X && ...`
// stops there.
async function confirm(question: string): Promise<boolean> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string | { interrupted: number }>((res) => {
    rl.question(question, res);
    rl.on("SIGINT", () => res({ interrupted: 130 })); // Ctrl-C
    rl.on("close", () => res({ interrupted: 1 })); // Ctrl-D, no answer
  });
  rl.close();
  if (typeof answer !== "string") {
    console.error("\nAborted.");
    process.exit(answer.interrupted);
  }
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

export function registerProjectCommands(program: Command): void {
  const projectCmd = program.command("project").description("manage projects");

  projectCmd
    .command("create <name>")
    .description("create a new project")
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const validName = validateProjectName(name);
      await withDb(opts, async (db) => {
        const project = await createProject(db, validName);
        printResult(opts, project, `Created project "${project.name}" (${project.project_uuid})`, project.project_uuid);
      }, { create: true });
    });

  projectCmd
    .command("list")
    .description("list all projects")
    .action(async (_opts: unknown, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withDb(opts, async (db) => {
        printRows(opts, await listProjects(db), {
          quiet: (p) => p.name,
          empty: "No projects found.",
          headers: ["Name", "UUID", "Created"],
          row: (p) => [p.name, p.project_uuid, p.created_at],
        });
      });
    });

  projectCmd
    .command("delete <name>")
    .description("delete a project and all its data")
    .option("--force", "skip confirmation")
    .action(async (given: string, cmdOpts: { force?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      // Check before asking: confirming the deletion of a missing project is pointless
      const project = await withDb(opts, (db) => getProjectByName(db, given));
      if (!project) throw new AppError(`Project "${given}" not found`);
      // The name as stored (" Sp " finds Sp), in the prompt and the result
      const { name } = project;
      if (!cmdOpts.force) {
        if (!process.stdin.isTTY) {
          throw new AppError(`Refusing to delete project "${name}" without confirmation: pass --force when not running interactively`);
        }
        // Declined, like Ctrl-C and Ctrl-D, fails: rw project delete X && ... stops
        if (!(await confirm(`Delete project "${name}" and all its data? (y/N) `))) throw new AppError("Aborted.");
      }
      await withDb(opts, async (db) => {
        if (!(await deleteProject(db, name))) throw new AppError(`Project "${name}" not found`);
        printResult(opts, { deleted: true, name }, `Deleted project "${name}"`);
      });
    });

  projectCmd
    .command("history")
    .description("show revision history across all tickets in a project")
    .option(...PROJECT_OPTION)
    .option("--since <timestamp>", "only show revisions after this ISO timestamp")
    .option("--limit <n>", "maximum number of revisions", parseNonNegativeIntOption)
    .option("--offset <n>", "number of revisions to skip", parseNonNegativeIntOption)
    .action(async (cmdOpts: ProjectOptions & { since?: string; limit?: number; offset?: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const revisions = await listProjectRevisions(db, project.id, cmdOpts.since, cmdOpts.limit, cmdOpts.offset);
        const none = revisions.length === 0 && (await listProjectRevisions(db, project.id, cmdOpts.since, 1)).length === 0;
        printRows(opts, revisions, {
          quiet: (r) => `${r.revised_at}\t${r.ticket_title}`,
          empty: emptyPage("revisions", cmdOpts, none),
          headers: ["Ticket", "Title (at revision)", "B", "P", "E", "R", "Revised At"],
          row: (r) => [
            r.ticket_title, r.title, String(r.benefit), String(r.penalty),
            String(r.estimate), String(r.risk), r.revised_at,
          ],
        });
      });
    });

  projectCmd
    .command("diff")
    .description("compare project state against a point in time")
    .option(...PROJECT_OPTION)
    .requiredOption("--since <timestamp>", "ISO timestamp to diff from")
    .action(async (cmdOpts: ProjectOptions & { since: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
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
        } else if (opts.quiet) {
          changes.forEach((c) => console.log(c.join("\t")));
        } else if (opts.csv) {
          console.log(formatTable(opts, ["Change", "Ticket", "Detail"], changes));
        } else {
          if (diff.newTickets.length > 0) {
            console.log(`New tickets (${diff.newTickets.length}):`);
            // Two decimals, as everywhere else in text output
            diff.newTickets.forEach((t) => console.log(`  + ${t.title} (priority: ${t.priority.toFixed(2)})`));
          }
          if (diff.updatedTickets.length > 0) {
            console.log(`Updated tickets (${diff.updatedTickets.length}):`);
            diff.updatedTickets.forEach((t) => {
              console.log(`  ~ ${t.title}`);
              t.changes.forEach((c) => console.log(`    ${c.field}: ${c.from} → ${c.to}`));
            });
          }
          if (diff.deletedTickets.length > 0) {
            console.log(`Deleted tickets (${diff.deletedTickets.length}):`);
            diff.deletedTickets.forEach((t) => console.log(`  - ${t.title}`));
          }
          if (diff.tagChanges.length > 0) {
            console.log(`Tag changes (${diff.tagChanges.length}):`);
            diff.tagChanges.forEach((t) => {
              if (t.added.length > 0) console.log(`  ${t.ticketTitle}: +${t.added.join(", +")}`);
              if (t.removed.length > 0) console.log(`  ${t.ticketTitle}: -${t.removed.join(", -")}`);
            });
          }
          if (changes.length === 0) console.log("No changes since " + cmdOpts.since);
        }
      });
    });
}
