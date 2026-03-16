#!/usr/bin/env node
import { Command } from "commander";
import { DB } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import {
  createProject,
  listProjects,
  deleteProject,
  getProjectByName,
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
  getTag,
  listTags,
  renameTag,
} from "./tags/repository.js";
import { assignTag, removeTag, getTicketTags, listTicketsByTag } from "./tags/assignment.js";
import { getTagChangeLog } from "./tags/audit.js";
import { createRevision, listRevisions, listProjectRevisions } from "./revisions/repository.js";
import { priority } from "./calculations/priority.js";
import {
  calculateRelativeWeights,
  Scoreable,
} from "./calculations/relative-weights.js";
import { weightedPriority } from "./calculations/weighted-priority.js";
import { getWeights, setWeights, resetWeights } from "./weights/repository.js";
import { getTicketTimes, averageLeadTime } from "./calculations/time.js";
import {
  validateProjectName,
  validateTicketTitle,
  validateTicketDescription,
  validateTagPrefix,
  validateTagValue,
  ValidationError,
} from "./validation/strings.js";
import { validateDbPath } from "./validation/paths.js";
import { sanitizeError } from "./validation/errors.js";
import { startMcpServer } from "./mcp/server.js";
import { exportCsv } from "./export/csv.js";
import { exportJson } from "./export/json.js";
import { importCsv } from "./import/csv.js";
import { importJson } from "./import/json.js";
import { backup } from "./backup/backup.js";
import { restore } from "./backup/restore.js";
import { createRelation, removeRelation, listRelations, listProjectRelations } from "./relations/repository.js";
import { getRelationType } from "./relations/types.js";
import { getProjectSummary } from "./reports/summary.js";
import { groupByTagPrefix } from "./reports/group.js";
import { getDistribution } from "./reports/distribution.js";
import { getBacklogHealth } from "./reports/health.js";
import { getEventLog } from "./reports/event-log.js";
import { getProjectDiff } from "./reports/diff.js";

import { upsertTicket } from "./tickets/repository.js";
import { validateExportPath } from "./validation/paths.js";
import { writeFileSync, readFileSync } from "fs";
import { VERSION } from "./version.generated.js";

const DEFAULT_DB = "./relative-weight.duckdb";

async function withDb<T>(
  opts: { db?: string },
  fn: (db: DB) => Promise<T>
): Promise<T> {
  const dbPath = validateDbPath(opts.db ?? process.env.RW_DB_PATH ?? DEFAULT_DB);
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

async function requireProject(db: DB, name: string) {
  const project = await getProjectByName(db, name);
  if (!project) {
    console.error(`Project "${name}" not found`);
    process.exit(1);
  }
  return project;
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    rows.reduce((max, r) => Math.max(max, (r[i] || "").length), h.length)
  );
  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const head = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const body = rows
    .map((r) => r.map((c, i) => c.padEnd(widths[i])).join(" | "))
    .join("\n");
  return `${head}\n${sep}\n${body}`;
}

const program = new Command();

program
  .name("rw")
  .description("Relative Weight CLI - prioritisation tool")
  .version(VERSION)
  .option("--db <path>", "path to DuckDB database file")
  .option("--json", "output as JSON")
  .option("--csv", "output as CSV")
  .option("--quiet", "minimal output")
  .option("--no-color", "disable colour output");

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
    });
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
      } else if (projects.length === 0) {
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
    if (!cmdOpts.force) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((res) =>
        rl.question(`Delete project "${name}" and all its data? (y/N) `, res)
      );
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log("Aborted.");
        return;
      }
    }
    await withDb(opts, async (db) => {
      const deleted = await deleteProject(db, name);
      if (deleted) {
        console.log(`Deleted project "${name}"`);
      } else {
        console.error(`Project "${name}" not found`);
        process.exit(1);
      }
    });
  });

projectCmd
  .command("history")
  .description("show revision history across all tickets in a project")
  .requiredOption("--project <name>", "project name")
  .option("--since <timestamp>", "only show revisions after this ISO timestamp")
  .option("--limit <n>", "maximum number of revisions", parseInt)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const revisions = await listProjectRevisions(db, project.id, cmdOpts.since, cmdOpts.limit);
      if (opts.json) {
        console.log(JSON.stringify(revisions));
      } else if (revisions.length === 0) {
        console.log("No revisions found.");
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
  .requiredOption("--project <name>", "project name")
  .requiredOption("--since <timestamp>", "ISO timestamp to diff from")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const diff = await getProjectDiff(db, project.id, cmdOpts.since);
      if (opts.json) {
        console.log(JSON.stringify(diff));
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
        if (diff.tagChanges.length > 0) {
          console.log(`Tag changes (${diff.tagChanges.length}):`);
          diff.tagChanges.forEach((t: any) => {
            if (t.added.length > 0) console.log(`  ${t.ticketTitle}: +${t.added.join(", +")}`);
            if (t.removed.length > 0) console.log(`  ${t.ticketTitle}: -${t.removed.join(", -")}`);
          });
        }
        if (diff.newTickets.length === 0 && diff.updatedTickets.length === 0 && diff.tagChanges.length === 0) {
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
  .requiredOption("--project <name>", "project name")
  .requiredOption("--title <title>", "ticket title")
  .option("--description <text>", "ticket description")
  .option("--benefit <n>", "benefit score (Fibonacci)", parseInt)
  .option("--penalty <n>", "penalty score (Fibonacci)", parseInt)
  .option("--estimate <n>", "estimate score (Fibonacci)", parseInt)
  .option("--risk <n>", "risk score (Fibonacci)", parseInt)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validTitle = validateTicketTitle(cmdOpts.title);
    const validDesc = validateTicketDescription(cmdOpts.description);
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
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
  .requiredOption("--project <name>", "project name")
  .option("--tag <prefix:value>", "filter by tag (repeatable, intersection)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--exclude-tag <prefix:value>", "exclude tickets with tag (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--search <text>", "filter by title substring (case-insensitive)")
  .option("--sort <field>", "sort by: priority, value, cost, benefit, penalty, estimate, risk")
  .option("--limit <n>", "max number of results", parseInt)
  .option("--offset <n>", "skip first N results", parseInt, 0)
  .option("--min-priority <n>", "minimum priority threshold", parseFloat)
  .option("--min-value <n>", "minimum value (benefit+penalty) threshold", parseFloat)
  .option("--max-cost <n>", "maximum cost (estimate+risk) threshold", parseFloat)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      let tickets = await listTickets(db, project.id);

      // Tag intersection filter
      for (const tagStr of (cmdOpts.tag as string[])) {
        const [prefix, value] = tagStr.split(":");
        const tag = await getTag(db, project.id, prefix, value);
        if (tag) {
          const ids = new Set(await listTicketsByTag(db, project.id, tag.id));
          tickets = tickets.filter((t) => ids.has(t.id));
        } else {
          tickets = [];
        }
      }

      // Exclude-tag filter
      for (const tagStr of (cmdOpts.excludeTag as string[])) {
        const [prefix, value] = tagStr.split(":");
        const tag = await getTag(db, project.id, prefix, value);
        if (tag) {
          const ids = new Set(await listTicketsByTag(db, project.id, tag.id));
          tickets = tickets.filter((t) => !ids.has(t.id));
        }
      }

      // Title search
      if (cmdOpts.search) {
        const needle = cmdOpts.search.toLowerCase();
        tickets = tickets.filter((t) => t.title.toLowerCase().includes(needle));
      }

      const enriched = tickets.map((t) => ({
        ...t,
        value: t.benefit + t.penalty,
        cost: t.estimate + t.risk,
        priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
      }));

      // Score threshold filters
      let filtered = enriched;
      if (cmdOpts.minPriority != null) filtered = filtered.filter((t) => t.priority >= cmdOpts.minPriority);
      if (cmdOpts.minValue != null) filtered = filtered.filter((t) => t.value >= cmdOpts.minValue);
      if (cmdOpts.maxCost != null) filtered = filtered.filter((t) => t.cost <= cmdOpts.maxCost);

      if (cmdOpts.sort) {
        const key = cmdOpts.sort as keyof (typeof filtered)[0];
        filtered.sort((a, b) => (b[key] as number) - (a[key] as number));
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
        console.log("title,benefit,penalty,estimate,risk,value,cost,priority");
        filtered.forEach((t) =>
          console.log(`${t.title},${t.benefit},${t.penalty},${t.estimate},${t.risk},${t.value},${t.cost},${t.priority}`)
        );
      } else if (filtered.length === 0) {
        console.log("No tickets found.");
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
  .requiredOption("--project <name>", "project name")
  .requiredOption("--title <title>", "ticket to update (by current title)")
  .option("--new-title <title>", "new title")
  .option("--description <text>", "new description")
  .option("--benefit <n>", "benefit score", parseInt)
  .option("--penalty <n>", "penalty score", parseInt)
  .option("--estimate <n>", "estimate score", parseInt)
  .option("--risk <n>", "risk score", parseInt)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validNewTitle = cmdOpts.newTitle ? validateTicketTitle(cmdOpts.newTitle) : undefined;
    const validDesc = validateTicketDescription(cmdOpts.description);
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.title);
      if (!ticket) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      await createRevision(db, ticket);
      const updated = await updateTicket(db, project.id, ticket.id, {
        title: validNewTitle,
        description: validDesc,
        benefit: cmdOpts.benefit,
        penalty: cmdOpts.penalty,
        estimate: cmdOpts.estimate,
        risk: cmdOpts.risk,
      });
      if (opts.json) {
        console.log(JSON.stringify(updated));
      } else {
        console.log(`Updated "${updated.title}" [B:${updated.benefit} P:${updated.penalty} E:${updated.estimate} R:${updated.risk}]`);
      }
    });
  });

ticketCmd
  .command("delete")
  .description("delete a ticket")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--title <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.title);
      if (!ticket) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      await deleteTicket(db, project.id, ticket.id);
      console.log(`Deleted ticket "${cmdOpts.title}"`);
    });
  });

ticketCmd
  .command("history")
  .description("show revision history for a ticket")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--title <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.title);
      if (!ticket) {
        console.error(`Ticket "${cmdOpts.title}" not found`);
        process.exit(1);
      }
      const revisions = await listRevisions(db, ticket.id);
      if (opts.json) {
        console.log(JSON.stringify(revisions));
      } else if (revisions.length === 0) {
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
  .requiredOption("--project <name>", "project name")
  .requiredOption("--title <title>", "ticket title (used as unique key)")
  .option("--description <text>", "ticket description")
  .option("--benefit <n>", "benefit score (Fibonacci)", parseInt)
  .option("--penalty <n>", "penalty score (Fibonacci)", parseInt)
  .option("--estimate <n>", "estimate score (Fibonacci)", parseInt)
  .option("--risk <n>", "risk score (Fibonacci)", parseInt)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const validTitle = validateTicketTitle(cmdOpts.title);
    const validDesc = validateTicketDescription(cmdOpts.description);
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const existing = await getTicketByTitle(db, project.id, validTitle);
      if (existing) {
        await createRevision(db, existing);
      }
      const result = await upsertTicket(db, project.id, validTitle, {
        description: validDesc,
        benefit: cmdOpts.benefit,
        penalty: cmdOpts.penalty,
        estimate: cmdOpts.estimate,
        risk: cmdOpts.risk,
      });
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else {
        const t = result.ticket;
        console.log(
          `${result.action === "created" ? "Created" : "Updated"} ticket "${t.title}" (${t.ticket_uuid}) [B:${t.benefit} P:${t.penalty} E:${t.estimate} R:${t.risk}]`
        );
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
  .requiredOption("--project <name>", "project name")
  .action(async (tagStr: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const [rawPrefix, rawValue] = tagStr.split(":");
    if (!rawPrefix || !rawValue) {
      console.error("Tag must be in prefix:value format");
      process.exit(1);
    }
    const prefix = validateTagPrefix(rawPrefix);
    const value = validateTagValue(rawValue);
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const tag = await createTag(db, project.id, prefix, value);
      if (opts.json) console.log(JSON.stringify(tag));
      else console.log(`Created tag "${prefix}:${value}"`);
    });
  });

tagCmd
  .command("assign <tags...>")
  .description("assign one or more tags to one or more tickets")
  .requiredOption("--project <name>", "project name")
  .option("--ticket <title>", "ticket title (repeatable)", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .action(async (tagStrs: string[], cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const tickets: string[] = cmdOpts.ticket;
    if (tickets.length === 0) { console.error("At least one --ticket is required"); process.exit(1); }
    const parsedTags = tagStrs.map((s: string) => {
      const [rawPrefix, rawValue] = s.split(":");
      return { raw: s, prefix: validateTagPrefix(rawPrefix || ""), value: validateTagValue(rawValue || "") };
    });
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      for (const ticketTitle of tickets) {
        const ticket = await getTicketByTitle(db, project.id, ticketTitle);
        if (!ticket) { console.error(`Ticket "${ticketTitle}" not found`); process.exit(1); }
        for (const t of parsedTags) {
          let tag = await getTag(db, project.id, t.prefix, t.value);
          if (!tag) tag = await createTag(db, project.id, t.prefix, t.value);
          const assigned = await assignTag(db, ticket.id, tag.id);
          console.log(assigned ? `Assigned "${t.raw}" to "${ticketTitle}"` : `Tag "${t.raw}" already assigned to "${ticketTitle}"`);
        }
      }
    });
  });

tagCmd
  .command("remove <tag>")
  .description("remove a tag from a ticket")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--ticket <title>", "ticket title")
  .action(async (tagStr: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const [rawPrefix, rawValue] = tagStr.split(":");
    const prefix = validateTagPrefix(rawPrefix || "");
    const value = validateTagValue(rawValue || "");
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.ticket);
      if (!ticket) { console.error(`Ticket "${cmdOpts.ticket}" not found`); process.exit(1); }
      const tag = await getTag(db, project.id, prefix, value);
      if (!tag) { console.error(`Tag "${tagStr}" not found`); process.exit(1); }
      const removed = await removeTag(db, ticket.id, tag.id);
      console.log(removed ? `Removed "${tagStr}" from "${cmdOpts.ticket}"` : `Tag "${tagStr}" was not assigned`);
    });
  });

tagCmd
  .command("list")
  .description("list all tags in a project")
  .requiredOption("--project <name>", "project name")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const tags = await listTags(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(tags));
      } else if (tags.length === 0) {
        console.log("No tags found.");
      } else {
        let currentPrefix = "";
        for (const tag of tags) {
          if (tag.prefix !== currentPrefix) {
            currentPrefix = tag.prefix;
            console.log(`\n${currentPrefix}:`);
          }
          console.log(`  ${tag.value}`);
        }
      }
    });
  });

tagCmd
  .command("rename")
  .description("rename a tag value")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--prefix <prefix>", "tag prefix")
  .requiredOption("--old <value>", "current tag value")
  .requiredOption("--new <value>", "new tag value")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    const prefix = validateTagPrefix(cmdOpts.prefix);
    const oldValue = validateTagValue(cmdOpts.old);
    const newValue = validateTagValue(cmdOpts.new);
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const tag = await getTag(db, project.id, prefix, oldValue);
      if (!tag) {
        console.error(`Tag "${prefix}:${oldValue}" not found`);
        process.exit(1);
      }
      const renamed = await renameTag(db, project.id, tag.id, prefix, newValue);
      if (opts.json) {
        console.log(JSON.stringify(renamed));
      } else {
        console.log(`Renamed "${prefix}:${oldValue}" to "${prefix}:${newValue}"`);
      }
    });
  });

tagCmd
  .command("log")
  .description("show tag change log for a ticket")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--ticket <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.ticket);
      if (!ticket) { console.error(`Ticket "${cmdOpts.ticket}" not found`); process.exit(1); }
      const log = await getTagChangeLog(db, ticket.id);
      if (opts.json) {
        console.log(JSON.stringify(log));
      } else if (log.length === 0) {
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
  .requiredOption("--project <name>", "project name")
  .requiredOption("--source <title>", "source ticket title")
  .requiredOption("--type <type>", "relation type (e.g. blocks, depends-on, relates-to)")
  .requiredOption("--target <title>", "target ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const source = await getTicketByTitle(db, project.id, cmdOpts.source);
      if (!source) { console.error(`Ticket "${cmdOpts.source}" not found`); process.exit(1); }
      const target = await getTicketByTitle(db, project.id, cmdOpts.target);
      if (!target) { console.error(`Ticket "${cmdOpts.target}" not found`); process.exit(1); }
      const relation = await createRelation(db, project.id, source.id, target.id, cmdOpts.type);
      if (opts.json) {
        console.log(JSON.stringify(relation));
      } else {
        console.log(`Created: "${cmdOpts.source}" ${cmdOpts.type} "${cmdOpts.target}"`);
      }
    });
  });

relationCmd
  .command("remove")
  .description("remove a relation between two tickets")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--source <title>", "source ticket title")
  .requiredOption("--type <type>", "relation type")
  .requiredOption("--target <title>", "target ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const source = await getTicketByTitle(db, project.id, cmdOpts.source);
      if (!source) { console.error(`Ticket "${cmdOpts.source}" not found`); process.exit(1); }
      const target = await getTicketByTitle(db, project.id, cmdOpts.target);
      if (!target) { console.error(`Ticket "${cmdOpts.target}" not found`); process.exit(1); }
      await removeRelation(db, project.id, source.id, target.id, cmdOpts.type);
      if (opts.json) {
        console.log(JSON.stringify({ removed: true }));
      } else {
        console.log(`Removed: "${cmdOpts.source}" ${cmdOpts.type} "${cmdOpts.target}"`);
      }
    });
  });

relationCmd
  .command("list")
  .description("list all relations for a ticket")
  .requiredOption("--project <name>", "project name")
  .requiredOption("--ticket <title>", "ticket title")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const ticket = await getTicketByTitle(db, project.id, cmdOpts.ticket);
      if (!ticket) { console.error(`Ticket "${cmdOpts.ticket}" not found`); process.exit(1); }
      const relations = await listRelations(db, project.id, ticket.id);
      if (opts.json) {
        console.log(JSON.stringify(relations));
      } else if (relations.length === 0) {
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
  .requiredOption("--project <name>", "project name")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const relations = await listProjectRelations(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(relations));
      } else if (relations.length === 0) {
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
  .requiredOption("--project <name>", "project name")
  .option("--set", "set weights (requires --w1..--w4)")
  .option("--reset", "reset weights to defaults")
  .option("--w1 <n>", "benefit weight", parseFloat)
  .option("--w2 <n>", "penalty weight", parseFloat)
  .option("--w3 <n>", "estimate weight", parseFloat)
  .option("--w4 <n>", "risk weight", parseFloat)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);

      if (cmdOpts.reset) {
        const config = await resetWeights(db, project.id);
        if (opts.json) {
          console.log(JSON.stringify(config));
        } else {
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
        } else {
          console.log(`Set weights for "${project.name}": w1=${config.w1} w2=${config.w2} w3=${config.w3} w4=${config.w4}`);
        }
        return;
      }

      // Default: view
      const config = await getWeights(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(config));
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
  .requiredOption("--project <name>", "project name")
  .option("--tag <prefix:value>", "scope to a tag")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      let tickets = await listTickets(db, project.id);

      if (cmdOpts.tag) {
        const [prefix, value] = cmdOpts.tag.split(":");
        const tag = await getTag(db, project.id, prefix, value);
        if (tag) {
          const ids = await listTicketsByTag(db, project.id, tag.id);
          tickets = tickets.filter((t) => ids.includes(t.id));
        } else {
          tickets = [];
        }
      }

      const scoreables: Scoreable[] = tickets;
      const results = tickets.map((t) => ({
        title: t.title,
        ...calculateRelativeWeights(t, scoreables),
      }));

      if (opts.json) {
        console.log(JSON.stringify(results));
      } else if (results.length === 0) {
        console.log("No tickets found.");
      } else {
        console.log(
          formatTable(
            ["Title", "Rel.Benefit", "Rel.Penalty", "Rel.Estimate", "Rel.Risk"],
            results.map((r) => [
              r.title, r.relativeBenefit.toFixed(2), r.relativePenalty.toFixed(2),
              r.relativeEstimate.toFixed(2), r.relativeRisk.toFixed(2),
            ])
          )
        );
      }
    });
  });

calcCmd
  .command("priority")
  .description("show weighted priorities")
  .requiredOption("--project <name>", "project name")
  .option("--w1 <n>", "benefit weight", parseFloat)
  .option("--w2 <n>", "penalty weight", parseFloat)
  .option("--w3 <n>", "estimate weight", parseFloat)
  .option("--w4 <n>", "risk weight", parseFloat)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const tickets = await listTickets(db, project.id);
      const config = await getWeights(db, project.id);
      const w1 = cmdOpts.w1 ?? config.w1;
      const w2 = cmdOpts.w2 ?? config.w2;
      const w3 = cmdOpts.w3 ?? config.w3;
      const w4 = cmdOpts.w4 ?? config.w4;

      const results = tickets.map((t) => ({
        title: t.title,
        priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
        weighted: weightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4),
      }));
      results.sort((a, b) => b.weighted - a.weighted);

      if (opts.json) {
        console.log(JSON.stringify(results));
      } else if (results.length === 0) {
        console.log("No tickets found.");
      } else {
        console.log(`Weights: w1=${w1} w2=${w2} w3=${w3} w4=${w4}\n`);
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
  .requiredOption("--project <name>", "project name")
  .option("--output <path>", "output file path")
  .option("--with-calculations", "include value, cost, priority columns")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const csv = await exportCsv(db, project.id, {
        withCalculations: cmdOpts.withCalculations,
      });
      if (cmdOpts.output) {
        const outPath = validateExportPath(cmdOpts.output);
        writeFileSync(outPath, csv, "utf-8");
        console.log(`Exported to ${outPath}`);
      } else {
        process.stdout.write(csv);
      }
    });
  });

exportCmd
  .command("json")
  .description("export project data as JSON")
  .requiredOption("--project <name>", "project name")
  .option("--output <path>", "output file path")
  .option("--with-history", "include revisions and tag change log")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const data = await exportJson(db, project.id, {
        withHistory: cmdOpts.withHistory,
      });
      const output = JSON.stringify(data, null, 2);
      if (cmdOpts.output) {
        const outPath = validateExportPath(cmdOpts.output);
        writeFileSync(outPath, output, "utf-8");
        console.log(`Exported to ${outPath}`);
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
  .requiredOption("--project <name>", "project name")
  .action(async (file: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const csv = readFileSync(file, "utf-8");
      const result = await importCsv(db, project.id, csv);
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(`Imported ${result.imported} tickets`);
      }
    });
  });

importCmd
  .command("json <file>")
  .description("import project data from JSON")
  .requiredOption("--project <name>", "project name")
  .action(async (file: string, cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const json = readFileSync(file, "utf-8");
      const result = await importJson(db, project.id, json);
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(`Imported ${result.imported} tickets`);
      }
    });
  });

// =============================================================================
//  REPORT COMMANDS
// =============================================================================

const reportCmd = program.command("report").description("reporting commands");

reportCmd
  .command("summary")
  .description("project summary with top-N by priority")
  .requiredOption("--project <name>", "project name")
  .option("--top <n>", "number of top tickets to show", parseInt, 5)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const summary = await getProjectSummary(db, project.id, cmdOpts.top);
      if (opts.json) {
        console.log(JSON.stringify(summary));
      } else {
        console.log(`Project: ${project.name}`);
        console.log(`Total tickets: ${summary.totalTickets}`);
        for (const [state, count] of Object.entries(summary.byState)) {
          console.log(`  state:${state}: ${count}`);
        }
        if (summary.topByPriority.length > 0) {
          console.log(`\nTop ${cmdOpts.top} by priority:`);
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
  .requiredOption("--project <name>", "project name")
  .requiredOption("--prefix <prefix>", "tag prefix to group by")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const groups = await groupByTagPrefix(db, project.id, cmdOpts.prefix);
      if (opts.json) {
        console.log(JSON.stringify(groups));
      } else if (groups.length === 0) {
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
  .requiredOption("--project <name>", "project name")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const dist = await getDistribution(db, project.id);
      if (opts.json) {
        console.log(JSON.stringify(dist));
      } else if (dist.every((d) => Object.values(d.counts).every((c) => c === 0))) {
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
  .requiredOption("--project <name>", "project name")
  .option("--threshold <n>", "high priority threshold", parseFloat, 1.5)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const health = await getBacklogHealth(db, project.id, cmdOpts.threshold);
      if (opts.json) {
        console.log(JSON.stringify(health));
      } else {
        console.log(`Project: ${project.name}`);
        console.log(`Total: ${health.totalTickets} | Done: ${health.doneTickets} | Open: ${health.openTickets}`);
        console.log(`High priority: ${health.highPriorityCount} | Low priority: ${health.lowPriorityCount}`);
        if (health.highToLowRatio !== null) {
          console.log(`High:Low ratio: ${health.highToLowRatio}`);
        }
        console.log(`Total backlog cost: ${health.totalBacklogCost}`);
      }
    });
  });

reportCmd
  .command("times")
  .description("lead and cycle time report")
  .requiredOption("--project <name>", "project name")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const tickets = await listTickets(db, project.id);
      const times = await Promise.all(tickets.map((t) => getTicketTimes(db, t.id)));
      const withDone = times.filter((t) => t.leadTimeDays !== undefined);
      const avg = averageLeadTime(times);
      if (opts.json) {
        console.log(JSON.stringify({ tickets: times, averageLeadTimeDays: avg }));
      } else if (withDone.length === 0) {
        console.log("No completed tickets found.");
      } else {
        const rows = withDone.map((t) => {
          const ticket = tickets.find((tk) => tk.id === t.ticketId);
          return [
            ticket?.title || String(t.ticketId),
            t.leadTimeDays !== undefined ? `${t.leadTimeDays}d` : "-",
            t.cycleTimeDays !== undefined ? `${t.cycleTimeDays}d` : "-",
          ];
        });
        console.log(formatTable(["Title", "Lead Time", "Cycle Time"], rows));
        if (avg !== undefined) console.log(`\nAverage lead time: ${avg}d`);
      }
    });
  });

reportCmd
  .command("event-log")
  .description("unified chronological event stream for a project")
  .requiredOption("--project <name>", "project name")
  .option("--since <timestamp>", "only events after this ISO timestamp")
  .option("--limit <n>", "maximum number of events", parseInt, 50)
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const project = await requireProject(db, cmdOpts.project);
      const events = await getEventLog(db, project.id, cmdOpts.since, cmdOpts.limit);
      if (opts.json) {
        console.log(JSON.stringify(events));
      } else if (events.length === 0) {
        console.log("No events found.");
      } else {
        for (const e of events) {
          const detail = typeof e.detail === "object" ? JSON.stringify(e.detail) : String(e.detail);
          console.log(`${e.timestamp}  ${e.type.padEnd(16)}  ${e.ticketTitle}  ${detail}`);
        }
      }
    });
  });

// =============================================================================
//  BACKUP / RESTORE COMMANDS
// =============================================================================

program
  .command("backup")
  .description("backup all projects to a JSON file")
  .requiredOption("--output <path>", "output file path (.json)")
  .action(async (cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const data = await backup(db);
      const output = JSON.stringify(data, null, 2);
      const outPath = validateExportPath(cmdOpts.output);
      writeFileSync(outPath, output, "utf-8");
      console.log(`Backup created: ${outPath}`);
      console.log(`  ${data.projects.length} project(s), schema version ${data.schemaVersion}`);
    });
  });

program
  .command("restore <file>")
  .description("restore all projects from a backup JSON file")
  .action(async (file: string, _cmdOpts: any, cmd: Command) => {
    const opts = cmd.optsWithGlobals();
    await withDb(opts, async (db) => {
      const json = readFileSync(file, "utf-8");
      const result = await restore(db, json);
      if (opts.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(`Restored ${result.projects} project(s), ${result.tickets} ticket(s), ${result.tags} tag(s)`);
      }
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
    const dbPath = opts.db ?? process.env.RW_DB_PATH ?? DEFAULT_DB;
    await startMcpServer(dbPath);
  });

program.parseAsync().catch((err) => {
  console.error(sanitizeError(err));
  process.exit(1);
});
