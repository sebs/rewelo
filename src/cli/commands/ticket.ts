import { Command } from "commander";
import { createTicket, deleteTicket, updateTicket, upsertTicket } from "../../tickets/repository.js";
import { listRevisions } from "../../revisions/repository.js";
import { queryTickets, requireTicket } from "../../app/tickets.js";
import { AppError, validateTicketDescription, validateTicketTitle } from "../../validation/strings.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, collect, parseFloatOption, parseNonNegativeIntOption, parseScoreOption, type ProjectOptions, type ScoreOptions } from "../options.js";
import { formatTable, printResult, printRows } from "../output.js";

type Scored = { benefit: number; penalty: number; estimate: number; risk: number };
const scores = (t: Scored) => `[B:${t.benefit} P:${t.penalty} E:${t.estimate} R:${t.risk}]`;

export function registerTicketCommands(program: Command): void {
  const ticketCmd = program.command("ticket").description("manage tickets");

  ticketCmd
    .command("create")
    .description("create a new ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--title <title>", "ticket title")
    .option("--description <text>", "ticket description")
    .option("--benefit <n>", "benefit score (Fibonacci)", parseScoreOption)
    .option("--penalty <n>", "penalty score (Fibonacci)", parseScoreOption)
    .option("--estimate <n>", "estimate score (Fibonacci)", parseScoreOption)
    .option("--risk <n>", "risk score (Fibonacci)", parseScoreOption)
    .action(async (cmdOpts: ProjectOptions & ScoreOptions & { title: string; description?: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
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
        printResult(opts, ticket, `Created ticket "${ticket.title}" (${ticket.ticket_uuid}) ${scores(ticket)}`, ticket.ticket_uuid);
      });
    });

  ticketCmd
    .command("list")
    .description("list tickets in a project")
    .option(...PROJECT_OPTION)
    .option("--tag <prefix:value>", "filter by tag (repeatable, intersection)", collect, [] as string[])
    .option("--exclude-tag <prefix:value>", "exclude tickets with tag (repeatable)", collect, [] as string[])
    .option("--search <text>", "filter by title substring (case-insensitive)")
    .option("--sort <field>", "sort by: priority, value, cost, benefit, penalty, estimate, risk")
    .option("--limit <n>", "max number of results", parseNonNegativeIntOption)
    .option("--offset <n>", "skip first N results", parseNonNegativeIntOption, 0)
    .option("--min-priority <n>", "minimum priority (the exact value / cost, not the two decimals shown)", parseFloatOption)
    .option("--min-value <n>", "minimum value (benefit+penalty) threshold", parseFloatOption)
    .option("--max-cost <n>", "maximum cost (estimate+risk) threshold", parseFloatOption)
    .action(async (cmdOpts: ProjectOptions & { tag: string[]; excludeTag: string[]; search?: string; sort?: string; limit?: number; offset: number; minPriority?: number; minValue?: number; maxCost?: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const { total, offset, items } = await queryTickets(db, project.id, {
          tags: cmdOpts.tag,
          excludeTags: cmdOpts.excludeTag,
          search: cmdOpts.search,
          minPriority: cmdOpts.minPriority,
          minValue: cmdOpts.minValue,
          maxCost: cmdOpts.maxCost,
          sort: cmdOpts.sort,
          offset: cmdOpts.offset,
          limit: cmdOpts.limit,
        });
        const row = (t: (typeof items)[number]) => [
          t.title, String(t.benefit), String(t.penalty), String(t.estimate),
          String(t.risk), String(t.value), String(t.cost), t.priority.toFixed(2),
        ];

        if (opts.json) {
          console.log(JSON.stringify({ total, offset, items }));
        } else if (opts.quiet) {
          items.forEach((t) => console.log(t.title));
        } else if (opts.csv) {
          // Before the empty check (a header line alone), and with lowercase headers
          console.log(formatTable(opts, ["title", "benefit", "penalty", "estimate", "risk", "value", "cost", "priority"], items.map(row)));
        } else if (items.length === 0) {
          // An offset past the end is not the same as no matching tickets
          console.log(total > 0 ? `Showing 0 of ${total} tickets` : "No tickets found.");
        } else {
          if (total > items.length) console.log(`Showing ${items.length} of ${total} tickets\n`);
          console.log(formatTable(opts, ["Title", "B", "P", "E", "R", "Value", "Cost", "Priority"], items.map(row)));
        }
      });
    });

  ticketCmd
    .command("update")
    .description("update a ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--title <title>", "ticket to update (by current title)")
    .option("--new-title <title>", "new title")
    .option("--description <text>", "new description")
    .option("--benefit <n>", "benefit score", parseScoreOption)
    .option("--penalty <n>", "penalty score", parseScoreOption)
    .option("--estimate <n>", "estimate score", parseScoreOption)
    .option("--risk <n>", "risk score", parseScoreOption)
    .action(async (cmdOpts: ProjectOptions & ScoreOptions & { title: string; newTitle?: string; description?: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const validNewTitle = cmdOpts.newTitle !== undefined ? validateTicketTitle(cmdOpts.newTitle) : undefined;
      const validDesc = validateTicketDescription(cmdOpts.description);
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const ticket = await requireTicket(db, project.id, cmdOpts.title);
        const updated = await updateTicket(db, project.id, ticket.id, {
          title: validNewTitle,
          description: validDesc,
          benefit: cmdOpts.benefit,
          penalty: cmdOpts.penalty,
          estimate: cmdOpts.estimate,
          risk: cmdOpts.risk,
        });
        const changed = (["title", "description", "benefit", "penalty", "estimate", "risk"] as const).some(
          (field) => updated[field] !== ticket[field]
        );
        printResult(opts, updated, changed ? `Updated "${updated.title}" ${scores(updated)}` : `No changes to "${updated.title}"`);
      });
    });

  ticketCmd
    .command("delete")
    .description("delete a ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--title <title>", "ticket title")
    .action(async (cmdOpts: ProjectOptions & { title: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const ticket = await requireTicket(db, project.id, cmdOpts.title);
        // Another process may have deleted it since the lookup
        if (!(await deleteTicket(db, project.id, ticket.id))) throw new AppError(`Ticket "${cmdOpts.title}" not found`);
        printResult(opts, { deleted: true, title: ticket.title }, `Deleted ticket "${ticket.title}"`);
      });
    });

  ticketCmd
    .command("history")
    .description("show revision history for a ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--title <title>", "ticket title")
    .option("--limit <n>", "maximum number of revisions", parseNonNegativeIntOption)
    .option("--offset <n>", "number of revisions to skip", parseNonNegativeIntOption)
    .action(async (cmdOpts: ProjectOptions & { title: string; limit?: number; offset?: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const ticket = await requireTicket(db, project.id, cmdOpts.title);
        printRows(opts, await listRevisions(db, ticket.id, cmdOpts.limit, cmdOpts.offset), {
          quiet: (r) => r.revised_at,
          empty: "No revisions found.",
          headers: ["#", "Title", "B", "P", "E", "R", "Tags", "Revised At"],
          row: (r, i) => [
            String(i + 1), r.title, String(r.benefit), String(r.penalty),
            String(r.estimate), String(r.risk),
            Array.isArray(r.tags) ? r.tags.map((t) => `${t.prefix}:${t.value}`).join(", ") : String(r.tags),
            r.revised_at,
          ],
        });
      });
    });

  ticketCmd
    .command("upsert")
    .description("create a ticket if it does not exist, or update it if it does (matched by title)")
    .option(...PROJECT_OPTION)
    .requiredOption("--title <title>", "ticket title (used as unique key)")
    .option("--description <text>", "ticket description")
    .option("--benefit <n>", "benefit score (Fibonacci)", parseScoreOption)
    .option("--penalty <n>", "penalty score (Fibonacci)", parseScoreOption)
    .option("--estimate <n>", "estimate score (Fibonacci)", parseScoreOption)
    .option("--risk <n>", "risk score (Fibonacci)", parseScoreOption)
    .action(async (cmdOpts: ProjectOptions & ScoreOptions & { title: string; description?: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
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
        const t = result.ticket;
        const text =
          result.action === "unchanged"
            ? `No changes to "${t.title}"`
            : `${result.action === "created" ? "Created" : "Updated"} ticket "${t.title}" (${t.ticket_uuid}) ${scores(t)}`;
        printResult(opts, result, text, t.ticket_uuid);
      });
    });
}
