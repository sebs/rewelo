import { Command } from "commander";
import { getProjectSummary } from "../../reports/summary.js";
import { groupByTagPrefix } from "../../reports/group.js";
import { getDistribution } from "../../reports/distribution.js";
import { getBacklogHealth, highToLowRatioText } from "../../reports/health.js";
import { getEventLog } from "../../reports/event-log.js";
import { renderDashboard } from "../../reports/dashboard.js";
import { averageCycleTime, averageLeadTime, getProjectTimes, timesReport } from "../../reports/times.js";
import { validateExportPath } from "../../validation/paths.js";
import { validateTagPrefix } from "../../validation/strings.js";
import { displayWidth } from "../../display-width.js";
import { FIBONACCI } from "../../domain/scores.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, parseFloatOption, parseNonNegativeIntOption, type ProjectOptions } from "../options.js";
import { formatTable, printRows, reportWritten } from "../output.js";
import { writeFile } from "../files.js";

export function registerReportCommands(program: Command): void {
  const reportCmd = program.command("report").description("reporting commands");

  reportCmd
    .command("summary")
    .description("project summary with top-N by priority")
    .option(...PROJECT_OPTION)
    .option("--top <n>", "number of top tickets to show", parseNonNegativeIntOption, 5)
    .action(async (cmdOpts: ProjectOptions & { top: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
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
        } else if (opts.quiet) {
          rows.forEach((r) => console.log(r.join("\t")));
        } else if (opts.csv) {
          console.log(formatTable(opts, ["Section", "Name", "Value"], rows));
        } else {
          console.log(`Project: ${project.name}`);
          console.log(`Total tickets: ${summary.totalTickets}`);
          for (const [state, count] of Object.entries(summary.byState)) {
            console.log(`  state:${state}: ${count}`);
          }
          if (summary.withoutState > 0) console.log(`  (no state tag): ${summary.withoutState}`);
          if (summary.topByPriority.length > 0) {
            console.log(`\nTop ${summary.topByPriority.length} open by priority:`);
            summary.topByPriority.forEach((t, i) => console.log(`  ${i + 1}. ${t.title} (${t.priority.toFixed(2)})`));
          }
        }
      });
    });

  reportCmd
    .command("group")
    .description("group tickets by tag prefix")
    .option(...PROJECT_OPTION)
    .requiredOption("--prefix <prefix>", "tag prefix to group by")
    .action(async (cmdOpts: ProjectOptions & { prefix: string }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        printRows(opts, await groupByTagPrefix(db, project.id, validateTagPrefix(cmdOpts.prefix)), {
          quiet: (g) => `${g.value}\t${g.ticketCount}\t${g.averagePriority.toFixed(2)}`,
          empty: `No tickets with "${cmdOpts.prefix}:" tags found.`,
          headers: ["Value", "Tickets", "Avg Priority"],
          row: (g) => [g.value, String(g.ticketCount), g.averagePriority.toFixed(2)],
        });
      });
    });

  reportCmd
    .command("distribution")
    .description("Fibonacci score distribution")
    .option(...PROJECT_OPTION)
    .action(async (cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const dist = await getDistribution(db, project.id);
        const counts = (d: (typeof dist)[number]) => FIBONACCI.map((f) => d.counts[f] || 0);
        printRows(opts, dist, {
          quiet: (d) => [d.dimension, ...counts(d)].join("\t"),
          empty: "No tickets found.",
          isEmpty: dist.every((d) => Object.values(d.counts).every((c) => c === 0)),
          headers: ["Dimension", ...FIBONACCI.map(String)],
          row: (d) => [d.dimension, ...counts(d).map(String)],
        });
      });
    });

  reportCmd
    .command("health")
    .description("backlog health report")
    .option(...PROJECT_OPTION)
    .option("--threshold <n>", "high priority threshold (the exact value / cost, not the two decimals shown)", parseFloatOption, 1.5)
    .action(async (cmdOpts: ProjectOptions & { threshold: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const health = await getBacklogHealth(db, project.id, cmdOpts.threshold);
        const metrics: [string, unknown][] = Object.entries(health);
        if (opts.json) {
          console.log(JSON.stringify(health));
        } else if (opts.quiet) {
          metrics.forEach(([name, value]) => console.log(`${name}\t${value ?? ""}`));
        } else if (opts.csv) {
          console.log(formatTable(opts, ["Metric", "Value"], metrics));
        } else {
          console.log(`Project: ${project.name}`);
          console.log(`Total: ${health.totalTickets} | Done: ${health.doneTickets} | Open: ${health.openTickets}`);
          console.log(`High priority: ${health.highPriorityCount} | Low priority: ${health.lowPriorityCount}`);
          console.log(`High:Low ratio: ${highToLowRatioText(health)}`);
          console.log(`Total backlog cost: ${health.totalBacklogCost}`);
        }
      });
    });

  reportCmd
    .command("times")
    .description("lead and cycle time report")
    .option(...PROJECT_OPTION)
    .action(async (cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const times = await getProjectTimes(db, project.id);
        const avgLead = averageLeadTime(times);
        const avgCycle = averageCycleTime(times);
        // An empty CSV field, not "-" (which the formula guard turns into '-)
        const none = opts.csv ? "" : "-";
        const days = (d: number | undefined) => (d !== undefined ? `${d}d` : none);
        // Every ticket, as in --json: open ones without times
        printRows(opts, times, {
          json: timesReport(times),
          quiet: (t) => `${t.ticketTitle}\t${t.leadTimeDays ?? ""}\t${t.cycleTimeDays ?? ""}`,
          empty: "No tickets found.",
          headers: ["Title", "Lead Time", "Cycle Time"],
          row: (t) => [t.ticketTitle, days(t.leadTimeDays), days(t.cycleTimeDays)],
          below: [
            avgLead === undefined ? "\nNo completed tickets yet." : `\nAverage lead time: ${avgLead}d`,
            ...(avgCycle !== undefined ? [`Average cycle time: ${avgCycle}d`] : []),
          ],
        });
      });
    });

  reportCmd
    .command("event-log")
    .description("unified chronological event stream for a project")
    .option(...PROJECT_OPTION)
    .option("--since <timestamp>", "only events after this ISO timestamp, oldest first")
    .option("--after <sequence>", "only events written after this sequence number, in write order", parseNonNegativeIntOption)
    .option("--limit <n>", "maximum number of events", parseNonNegativeIntOption, 50)
    .action(async (cmdOpts: ProjectOptions & { since?: string; after?: number; limit: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const events = await getEventLog(db, project.id, cmdOpts.since, cmdOpts.limit, cmdOpts.after);
        const detail = (e: (typeof events)[0]) => (typeof e.detail === "object" ? JSON.stringify(e.detail) : String(e.detail));
        if (opts.json) {
          console.log(JSON.stringify(events));
        } else if (opts.quiet) {
          events.forEach((e) => console.log(`${e.timestamp}\t${e.type}\t${e.ticketTitle}`));
        } else if (events.length === 0 && !opts.csv) {
          console.log(cmdOpts.limit === 0 ? "No events shown (--limit 0)." : "No events found.");
        } else if (opts.csv) {
          console.log(formatTable(opts, ["Timestamp", "Type", "Ticket", "Detail"], events.map((e) => [e.timestamp, e.type, e.ticketTitle, detail(e)])));
        } else {
          // The ticket column padded to its widest title, so the details line up
          const width = Math.max(...events.map((e) => displayWidth(e.ticketTitle)));
          for (const e of events) {
            const ticket = e.ticketTitle + " ".repeat(width - displayWidth(e.ticketTitle));
            console.log(`${e.timestamp}  ${e.type.padEnd(16)}  ${ticket}  ${detail(e)}`);
          }
        }
      });
    });

  reportCmd
    .command("dashboard")
    .description("generate a self-contained HTML dashboard")
    .option(...PROJECT_OPTION)
    .requiredOption("--output <path>", "output HTML file path")
    .option("--limit <n>", "rows per table (default 500)", parseNonNegativeIntOption)
    .action(async (cmdOpts: ProjectOptions & { output: string; limit?: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const html = await renderDashboard(db, project.id, project.name, {
          generatedAt: new Date().toISOString(),
          limit: cmdOpts.limit,
        });
        const outPath = validateExportPath(cmdOpts.output, [".html"]);
        writeFile(outPath, html);
        reportWritten(opts, outPath, `Dashboard written to ${outPath}`);
      });
    });
}
