import { Command } from "commander";
import { createRelation, listProjectRelations, listRelations, removeRelation } from "../../relations/repository.js";
import { normalizeRelationType } from "../../relations/types.js";
import { requireTicket } from "../../app/tickets.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, type ProjectOptions } from "../options.js";
import { printResult, printRows } from "../output.js";

export function registerRelationCommands(program: Command): void {
  const relationCmd = program.command("relation").description("manage ticket relations");

  relationCmd
    .command("create")
    .description("create a relation between two tickets")
    .option(...PROJECT_OPTION)
    .requiredOption("--source <title>", "source ticket title")
    .requiredOption("--type <type>", "relation type (e.g. blocks, depends-on, relates-to)")
    .requiredOption("--target <title>", "target ticket title")
    .action(async (cmdOpts: ProjectOptions & { source: string; type: string; target: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const source = await requireTicket(db, project.id, cmdOpts.source);
        const target = await requireTicket(db, project.id, cmdOpts.target);
        const relation = await createRelation(db, project.id, source.id, target.id, cmdOpts.type);
        printResult(opts, relation, `Created: "${source.title}" ${normalizeRelationType(cmdOpts.type)} "${target.title}"`);
      });
    });

  relationCmd
    .command("remove")
    .description("remove a relation between two tickets")
    .option(...PROJECT_OPTION)
    .requiredOption("--source <title>", "source ticket title")
    .requiredOption("--type <type>", "relation type")
    .requiredOption("--target <title>", "target ticket title")
    .action(async (cmdOpts: ProjectOptions & { source: string; type: string; target: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const source = await requireTicket(db, project.id, cmdOpts.source);
        const target = await requireTicket(db, project.id, cmdOpts.target);
        await removeRelation(db, project.id, source.id, target.id, cmdOpts.type);
        printResult(opts, { removed: true }, `Removed: "${source.title}" ${normalizeRelationType(cmdOpts.type)} "${target.title}"`);
      });
    });

  relationCmd
    .command("list")
    .description("list all relations for a ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--ticket <title>", "ticket title")
    .action(async (cmdOpts: ProjectOptions & { ticket: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const ticket = await requireTicket(db, project.id, cmdOpts.ticket);
        printRows(opts, await listRelations(db, project.id, ticket.id), {
          quiet: (r) => `${r.relation_type}\t${r.ticket_title}`,
          empty: "No relations found.",
          headers: ["Type", "Direction", "Ticket"],
          row: (r) => [r.relation_type, r.direction, r.ticket_title],
        });
      });
    });

  relationCmd
    .command("list-all")
    .description("list all relations in a project")
    .option(...PROJECT_OPTION)
    .action(async (cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        printRows(opts, await listProjectRelations(db, project.id), {
          quiet: (r) => `${r.source_title}\t${r.relation_type}\t${r.target_title}`,
          empty: "No relations found.",
          headers: ["Source", "Type", "Target"],
          row: (r) => [r.source_title, r.relation_type, r.target_title],
        });
      });
    });
}
