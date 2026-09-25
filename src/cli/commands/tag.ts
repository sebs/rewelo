import { Command } from "commander";
import { createTag, deleteTag, getTag, listTags, renameTag } from "../../tags/repository.js";
import { removeTag } from "../../tags/assignment.js";
import { getTagChangeLog } from "../../tags/audit.js";
import { requireTicket } from "../../app/tickets.js";
import { assignTags, prepareTags } from "../../app/tagging.js";
import { DB } from "../../db/connection.js";
import { AppError } from "../../errors.js";
import { parseTag, validateTagPrefix, validateTagValue } from "../../validation/strings.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, collect, type ProjectOptions } from "../options.js";
import { formatTable, printResult, printRows } from "../output.js";

async function requireTag(db: DB, projectId: number, prefix: string, value: string) {
  const tag = await getTag(db, projectId, prefix, value);
  if (!tag) throw new AppError(`Tag "${prefix}:${value}" not found`);
  return tag;
}

export function registerTagCommands(program: Command): void {
  const tagCmd = program.command("tag").description("manage tags");

  tagCmd
    .command("create <tag>")
    .description("create a tag (format: prefix:value)")
    .option(...PROJECT_OPTION)
    .action(async (tagStr: string, cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const { prefix, value } = parseTag(tagStr);
      await withProject(opts, cmdOpts.project, async (db, project) => {
        printResult(opts, await createTag(db, project.id, prefix, value), `Created tag "${prefix}:${value}"`);
      });
    });

  tagCmd
    .command("assign <tags...>")
    .description("assign one or more tags to one or more tickets")
    .option(...PROJECT_OPTION)
    .option("--ticket <title>", "ticket title (repeatable)", collect, [] as string[])
    .action(async (tagStrs: string[], cmdOpts: ProjectOptions & { ticket: string[] }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const tickets: string[] = cmdOpts.ticket;
      if (tickets.length === 0) throw new AppError("At least one --ticket is required");
      // The same tag or ticket named twice (possibly spelt differently) is
      // applied and reported once
      const parsedTags = prepareTags(tagStrs.map((s: string) => parseTag(s)));
      await withProject(opts, cmdOpts.project, async (db, project) => {
        // The CLI's JSON never said which tags were created
        const results = (await assignTags(db, project.id, tickets, parsedTags)).map(({ tagCreated: _, ...r }) => r);
        printResult(
          opts,
          results,
          results.map((r) => {
            const note = r.replaced ? ` (replaced ${r.replaced.map((x) => `"${x}"`).join(", ")})` : "";
            return r.status === "assigned" ? `Assigned "${r.tag}" to "${r.ticket}"${note}` : `Tag "${r.tag}" already assigned to "${r.ticket}"`;
          })
        );
      });
    });

  tagCmd
    .command("remove <tag>")
    .description("remove a tag from a ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--ticket <title>", "ticket title")
    .action(async (tagStr: string, cmdOpts: ProjectOptions & { ticket: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const { prefix, value } = parseTag(tagStr);
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const ticket = await requireTicket(db, project.id, cmdOpts.ticket);
        const tag = await requireTag(db, project.id, prefix, value);
        const removed = await removeTag(db, ticket.id, tag.id);
        printResult(
          opts,
          { ticket: ticket.title, tag: `${prefix}:${value}`, status: removed ? "removed" : "was_not_assigned" },
          removed ? `Removed "${prefix}:${value}" from "${ticket.title}"` : `Tag "${prefix}:${value}" was not assigned`
        );
      });
    });

  tagCmd
    .command("list")
    .description("list all tags in a project")
    .option(...PROJECT_OPTION)
    .action(async (cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const tags = await listTags(db, project.id);
        if (opts.json) {
          console.log(JSON.stringify(tags));
        } else if (opts.csv) {
          console.log(formatTable(opts, ["prefix", "value"], tags.map((t) => [t.prefix, t.value])));
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
    .option(...PROJECT_OPTION)
    .action(async (tagStr: string, cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const { prefix, value } = parseTag(tagStr);
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const tag = await requireTag(db, project.id, prefix, value);
        await deleteTag(db, project.id, tag.id);
        printResult(opts, { deleted: true, tag: `${prefix}:${value}` }, `Deleted tag "${prefix}:${value}"`);
      });
    });

  tagCmd
    .command("rename")
    .description("rename a tag value")
    .option(...PROJECT_OPTION)
    .requiredOption("--prefix <prefix>", "tag prefix")
    .requiredOption("--old <value>", "current tag value")
    .requiredOption("--new <value>", "new tag value")
    .action(async (cmdOpts: ProjectOptions & { prefix: string; old: string; new: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const prefix = validateTagPrefix(cmdOpts.prefix);
      const oldValue = validateTagValue(cmdOpts.old);
      const newValue = validateTagValue(cmdOpts.new);
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const tag = await requireTag(db, project.id, prefix, oldValue);
        const renamed = await renameTag(db, project.id, tag.id, prefix, newValue);
        printResult(
          opts,
          renamed,
          oldValue === newValue ? `No changes to "${prefix}:${oldValue}"` : `Renamed "${prefix}:${oldValue}" to "${prefix}:${newValue}"`
        );
      });
    });

  tagCmd
    .command("log")
    .description("show tag change log for a ticket")
    .option(...PROJECT_OPTION)
    .requiredOption("--ticket <title>", "ticket title")
    .action(async (cmdOpts: ProjectOptions & { ticket: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const ticket = await requireTicket(db, project.id, cmdOpts.ticket);
        printRows(opts, await getTagChangeLog(db, ticket.id), {
          quiet: (e) => `${e.action}\t${e.prefix}:${e.value}`,
          empty: "No tag changes recorded.",
          headers: ["Action", "Tag", "Changed At"],
          row: (e) => [e.action, `${e.prefix}:${e.value}`, e.changed_at],
        });
      });
    });
}
