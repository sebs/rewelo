import { Command } from "commander";
import { getProjectSummary } from "../../reports/summary.js";
import { groupByTagPrefix } from "../../reports/group.js";
import { getDistribution } from "../../reports/distribution.js";
import { getBacklogHealth, highToLowRatioText } from "../../reports/health.js";
import { getEventLog } from "../../reports/event-log.js";
import { renderDashboard } from "../../reports/dashboard.js";
import { averageCycleTime, averageLeadTime, getProjectTimes, timesReport } from "../../reports/times.js";
import { DEFAULT_FLOW_WEEKS, getFlowReport, type Percentiles } from "../../reports/flow-metrics.js";
import { DEFAULT_HISTORY_DAYS, forecastText, getForecast } from "../../reports/forecast.js";
import { validateExportPath } from "../../validation/paths.js";
import { validateTagPrefix } from "../../validation/strings.js";
import { displayWidth } from "../../display-width.js";
import { FIBONACCI } from "../../domain/scores.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, parseFloatOption, parseNonNegativeIntOption, parsePositiveIntOption, type ProjectOptions } from "../options.js";
import { emptyPage, escapeControls, formatTable, printRows, reportWritten } from "../output.js";
import { writeFile } from "../files.js";
import { versionFilePath, watchDashboard } from "../dashboard-watch.js";
import type { DB } from "../../db/connection.js";
import type { Project } from "../../projects/repository.js";

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
        // The prefix as it is stored and searched: trimmed, lowercase
        const prefix = validateTagPrefix(cmdOpts.prefix);
        printRows(opts, await groupByTagPrefix(db, project.id, prefix), {
          quiet: (g) => `${g.value}\t${g.ticketCount}\t${g.averagePriority.toFixed(2)}`,
          empty: `No tickets with "${prefix}:" tags found.`,
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
    .option("--stale-days <n>", "days without a change of scores after which an open ticket is stale", parseNonNegativeIntOption, 90)
    .action(async (cmdOpts: ProjectOptions & { threshold: number; staleDays: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const health = await getBacklogHealth(db, project.id, cmdOpts.threshold, cmdOpts.staleDays);
        // One value per metric: the stale tickets as their number
        const metrics: [string, unknown][] = Object.entries(health).map(([name, value]) => [name, Array.isArray(value) ? value.length : value]);
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
          // The oldest first, as many as a terminal shows at a glance
          const SHOWN = 10;
          console.log(`Not re-scored for ${health.staleDays} days or more: ${health.staleTickets.length}`);
          for (const t of health.staleTickets.slice(0, SHOWN)) console.log(`  ${escapeControls(t.title)} (${t.days} days)`);
          if (health.staleTickets.length > SHOWN) console.log(`  … and ${health.staleTickets.length - SHOWN} more (--json lists them all)`);
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
    .command("flow")
    .description("throughput per week, cycle and lead time percentiles, and the work in progress by age")
    .option(...PROJECT_OPTION)
    .option("--weeks <n>", "complete weeks to cover, 0 for all", parseNonNegativeIntOption, DEFAULT_FLOW_WEEKS)
    .action(async (cmdOpts: ProjectOptions & { weeks: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const flow = await getFlowReport(db, project.id, cmdOpts.weeks);
        // Section, name, value rows for --csv and --quiet
        const times = (section: string, p: Percentiles) => [
          [section, "count", p.count],
          ...(["p50", "p85", "p95"] as const).map((k) => [section, k, p[k] ?? ""]),
        ];
        const rows: unknown[][] = [
          ...flow.throughput.map((w) => ["throughput", w.weekStart, w.done]),
          ["throughput", "average_per_week", flow.averagePerWeek ?? ""],
          ...times("cycle_time_days", flow.cycleTimeDays),
          ...times("lead_time_days", flow.leadTimeDays),
          ...flow.inProgress.map((t) => ["in_progress_days", t.title, t.ageDays]),
        ];
        if (opts.json) {
          console.log(JSON.stringify(flow));
        } else if (opts.quiet) {
          rows.forEach((r) => console.log(r.map((v) => escapeControls(String(v))).join("\t")));
        } else if (opts.csv) {
          console.log(formatTable(opts, ["Section", "Name", "Value"], rows));
        } else {
          const span = flow.weeks > 0 ? `the last ${flow.weeks} complete weeks` : `all complete weeks since ${flow.from}`;
          console.log(`Project: ${project.name}`);
          console.log(`Throughput over ${span}: ${flow.averagePerWeek === null ? "no complete week yet" : `${flow.averagePerWeek} tickets per week`}`);
          console.log(formatTable(opts, ["Week of", "Done"], flow.throughput.map((w) => [w.weekStart, w.partial ? `${w.done} (so far)` : String(w.done)])));
          const line = (name: string, p: Percentiles) =>
            p.count === 0
              ? `${name}: no tickets done since ${flow.from}`
              : `${name} (${p.count} tickets): 50% within ${p.p50} days, 85% within ${p.p85}, 95% within ${p.p95}`;
          console.log(`\n${line("Cycle time", flow.cycleTimeDays)}`);
          console.log(line("Lead time", flow.leadTimeDays));
          if (flow.inProgress.length === 0) {
            console.log("\nNothing in progress.");
          } else {
            console.log(`\nIn progress (${flow.inProgress.length}), oldest first:`);
            for (const t of flow.inProgress) {
              const late = t.olderThanP85 ? `, older than 85% of finished tickets took` : "";
              console.log(`  ${escapeControls(t.title)}: ${t.ageDays} days since ${t.startedAt.slice(0, 10)}${late}`);
            }
          }
        }
      });
    });

  reportCmd
    .command("forecast")
    .description("when the open tickets (or --items of them) will be done, at the recent pace")
    .option(...PROJECT_OPTION)
    .option("--items <n>", "tickets to forecast (default: the open ones)", parseNonNegativeIntOption)
    .option("--history-days <n>", "days of recent pace to go by", parsePositiveIntOption, DEFAULT_HISTORY_DAYS)
    .action(async (cmdOpts: ProjectOptions & { items?: number; historyDays: number }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const forecast = await getForecast(db, project.id, { items: cmdOpts.items, historyDays: cmdOpts.historyDays });
        const none = opts.csv ? "" : "-";
        printRows(opts, forecast.outcomes, {
          json: forecast,
          quiet: (o) => `${o.likelihood}\t${o.days ?? ""}\t${o.date ?? ""}`,
          isEmpty: forecast.outcomes.length === 0,
          empty: forecastText(forecast),
          above: [`Project: ${project.name}`, forecastText(forecast), ""],
          headers: ["Likelihood", "Days", "Done by"],
          row: (o) => [`${o.likelihood}%`, o.days === null ? none : String(o.days), o.date ?? "not within ten years"],
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
          events.forEach((e) => console.log(`${e.timestamp}\t${e.type}\t${escapeControls(e.ticketTitle)}`));
        } else if (events.length === 0 && !opts.csv) {
          // --limit 0 shows none, which isn't the same as there being none
          const none = cmdOpts.limit !== 0 || (await getEventLog(db, project.id, cmdOpts.since, 1, cmdOpts.after)).length === 0;
          console.log(emptyPage("events", { limit: cmdOpts.limit }, none));
        } else if (opts.csv) {
          console.log(formatTable(opts, ["Timestamp", "Type", "Ticket", "Detail"], events.map((e) => [e.timestamp, e.type, e.ticketTitle, detail(e)])));
        } else {
          // The ticket column padded to its widest title, so the details line up
          const titles = events.map((e) => escapeControls(e.ticketTitle));
          const width = Math.max(...titles.map(displayWidth));
          for (const [i, e] of events.entries()) {
            const ticket = titles[i] + " ".repeat(width - displayWidth(titles[i]));
            // The details quote titles and descriptions: JSON leaves U+2028,
            // U+2029 and C1 controls raw, which broke the line in two
            console.log(`${e.timestamp}  ${e.type.padEnd(16)}  ${ticket}  ${escapeControls(detail(e))}`);
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
    .option("--watch", "write it again whenever the database changes, until stopped (Ctrl-C); an open page reloads itself")
    .action(async (cmdOpts: ProjectOptions & { output: string; limit?: number; watch?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        if (cmdOpts.watch) return watch(opts, db, project, cmdOpts);
        const html = await renderDashboard(db, project.id, project.name, {
          generatedAt: new Date().toISOString(),
          limit: cmdOpts.limit,
        });
        const outPath = validateExportPath(cmdOpts.output, [".html"]);
        writeFile(outPath, html);
        reportWritten(opts, outPath, `Dashboard written to ${outPath}`);
      });
    });

  // Until Ctrl-C (or SIGTERM), which ends the command normally: the
  // database is closed and the exit code is 0
  async function watch(opts: GlobalOptions, db: DB, project: Project, cmdOpts: { output: string; limit?: number }): Promise<void> {
    const outPath = validateExportPath(cmdOpts.output, [".html"]);
    validateExportPath(versionFilePath(outPath), [".js"]);
    const stop = new AbortController();
    const onSignal = () => stop.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    let first = true;
    try {
      await watchDashboard({
        db,
        project,
        output: outPath,
        limit: cmdOpts.limit,
        signal: stop.signal,
        written: () => {
          reportWritten(
            opts,
            outPath,
            first
              ? `Dashboard written to ${outPath}; watching for changes (Ctrl-C to stop)`
              : `Dashboard updated at ${new Date().toISOString()}`
          );
          first = false;
        },
      });
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  }
}
