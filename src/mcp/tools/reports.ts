import { z } from "zod";
import { getProjectTimes, timesReport } from "../../reports/times.js";
import { getProjectDiff } from "../../reports/diff.js";
import { getDistribution } from "../../reports/distribution.js";
import { getEventLog } from "../../reports/event-log.js";
import { groupByTagPrefix } from "../../reports/group.js";
import { getBacklogHealth } from "../../reports/health.js";
import { getProjectSummary } from "../../reports/summary.js";
import { validateTagPrefix } from "../../validation/strings.js";
import { dashboard, documentOrLink, MAX_DASHBOARD_ROWS, resourceUri } from "../documents.js";
import { DASHBOARD_APP_META, DASHBOARD_VERSION_META } from "../app.js";
import { DEFAULT_FLOW_WEEKS, getFlowReport } from "../../reports/flow-metrics.js";
import { DEFAULT_HISTORY_DAYS, FORECAST_TRIALS, getForecast } from "../../reports/forecast.js";
import { getEstimateAccuracy } from "../../reports/estimates.js";
import { READ, PROJECT_ARG, type McpContext } from "../toolkit.js";

export function registerReportTools(ctx: McpContext): void {
  const { tool, inProject, dataVersion } = ctx;

  tool(
    "report_summary",
    "Get project overview: total tickets, breakdown by state tag, and the top-N open (not state:done) tickets by priority. Good starting point for any project.",
    {
      ...PROJECT_ARG,
      topN: z.number().int().nonnegative().optional().describe("Number of top tickets"),
    },
    READ,
    ({ project, topN }) =>
      inProject(project, (db, proj) => getProjectSummary(db, proj.id, topN ?? 5))
  );

  tool(
    "report_times",
    "Calculate lead time (created→done) and cycle time (wip→done) per ticket, plus their averages (whole days; null where there is no value). Prerequisite: assign state:wip and state:done tags to tickets.",
    { ...PROJECT_ARG },
    READ,
    ({ project }) =>
      inProject(project, async (db, proj) => {
        const times = await getProjectTimes(db, proj.id);
        return timesReport(times);
      })
  );

  tool(
    "report_flow",
    "Flow metrics computed from the state tags: tickets done per week (weeks start Monday, UTC; the last is the current week so far), the average per complete week, cycle time (wip→done) and lead time (created→done) as 50th/85th/95th percentiles in days over the tickets done in the window, and the tickets in progress (started, not done) by age, flagged when older than the 85th percentile of cycle time. Use it instead of paging through event_log for throughput and percentiles.",
    {
      ...PROJECT_ARG,
      weeks: z.number().int().nonnegative().optional().describe(`Complete weeks to cover (default ${DEFAULT_FLOW_WEEKS}), 0 for all since the first ticket`),
    },
    READ,
    ({ project, weeks }) => inProject(project, (db, proj) => getFlowReport(db, proj.id, weeks ?? DEFAULT_FLOW_WEEKS))
  );

  tool(
    "report_forecast",
    `When the open tickets, or a number of them, will be done at the pace the project actually had: a Monte Carlo simulation replays days drawn at random from the last historyDays (how many tickets were done on each), ${FORECAST_TRIALS} times, and gives the number of days and the date by which the tickets are done in 50, 85 and 95% of the runs. It counts tickets, not their size, and assumes the coming weeks look like the recent ones. No outcomes when no ticket was done in the history. For "how much fits into N points of capacity" use plan_capacity instead.`,
    {
      ...PROJECT_ARG,
      items: z.number().int().nonnegative().optional().describe("Tickets to forecast (default: the open ones, not state:done)"),
      historyDays: z.number().int().positive().optional().describe(`Days of recent pace to go by (default ${DEFAULT_HISTORY_DAYS})`),
    },
    READ,
    ({ project, items, historyDays }) => inProject(project, (db, proj) => getForecast(db, proj.id, { items, historyDays }))
  );

  tool(
    "report_estimates",
    "Whether estimates predict how long tickets take: for the done tickets with a cycle time (wip→done), the median and 85th percentile of cycle time in days per estimate, the estimate taken as it was when work started (not after a re-estimate), Spearman's rank correlation of estimate and cycle time (null under 5 tickets, or when nothing varies) and a verdict in words. Also how many tickets were re-estimated after work started, and how many done tickets have no cycle time.",
    { ...PROJECT_ARG },
    READ,
    ({ project }) => inProject(project, (db, proj) => getEstimateAccuracy(db, proj.id))
  );

  tool(
    "report_health",
    "Assess backlog health: high/low priority ratio, open ticket count, total cost, and the stale tickets: open ones whose scores haven't changed for staleDays (a change of title, description or tags doesn't count), oldest first, worth re-scoring. highToLowRatio is null when no open ticket is low priority, also when there are no open tickets.",
    {
      ...PROJECT_ARG,
      threshold: z.number().optional().describe("High priority threshold, greater than 0 (default 1.5), compared with the exact value/cost, not the rounded priority"),
      staleDays: z.number().int().optional().describe("Days without a change of scores after which an open ticket counts as stale (default 90)"),
    },
    READ,
    ({ project, threshold, staleDays }) =>
      inProject(project, (db, proj) => getBacklogHealth(db, proj.id, threshold ?? 1.5, staleDays ?? 90))
  );

  tool(
    "report_distribution",
    "Count how many tickets use each Fibonacci score (1-21), per dimension (benefit, penalty, estimate, risk).",
    { ...PROJECT_ARG },
    READ,
    ({ project }) => inProject(project, (db, proj) => getDistribution(db, proj.id))
  );

  tool(
    "report_group",
    "Group tickets by the values of one tag prefix (e.g. team), with ticket count and average priority per value.",
    {
      ...PROJECT_ARG,
      prefix: z.string().describe("Tag prefix to group by"),
    },
    READ,
    async ({ project, prefix }) => {
      const validPrefix = validateTagPrefix(prefix);
      return inProject(project, (db, proj) => groupByTagPrefix(db, proj.id, validPrefix));
    }
  );

  tool(
    "report_dashboard",
    "Render a self-contained HTML dashboard (health, cumulative flow, tickets, distribution, relations). Returns the HTML document as text, or, when it is over 5 MB, a link to the resource with it. Hosts that support MCP Apps show it to the user in its page (ui://rewelo/dashboard.html).",
    {
      ...PROJECT_ARG,
      limit: z.number().int().nonnegative().max(MAX_DASHBOARD_ROWS).optional().describe("Rows per table (default 500)"),
    },
    READ,
    ({ project, limit }) =>
      inProject(project, async (db, proj) =>
        documentOrLink(
          // The version first: a change after it is seen on the next poll
          async () => dashboard(db, proj, await dataVersion(db), limit),
          resourceUri(proj.name, limit === undefined ? "dashboard" : `dashboard/${limit}`),
          "dashboard",
          "text/html"
        )
      ),
    DASHBOARD_APP_META
  );

  // Hidden from the model (visibility "app"): the dashboard's page calls it
  // every few seconds and renders the dashboard again only when it changed
  tool(
    "dashboard_version",
    "For the dashboard app: a token that changes whenever the dashboard may have changed (the database changed, or the day did). The page that shows report_dashboard's result calls it to know when to refresh; there is no need to call it otherwise.",
    { ...PROJECT_ARG },
    READ,
    ({ project }) => inProject(project, async (db) => ({ version: await dataVersion(db) })),
    DASHBOARD_VERSION_META
  );


  tool(
    "event_log",
    "Get a unified event stream combining ticket creates, updates, deletes, and tag changes. Without since/after: the newest events, newest first. With since or after: the events after it, oldest first. To poll incrementally without missing events, pass the sequence of the last event received as the next after.",
    {
      ...PROJECT_ARG,
      since: z.string().optional().describe("Only events after this ISO timestamp (then oldest first)"),
      after: z.number().int().nonnegative().optional().describe("Only events written after this sequence number (an earlier event's sequence), in write order"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of events to return (default 50)"),
    },
    READ,
    ({ project, since, after, limit }) =>
      inProject(project, (db, proj) => getEventLog(db, proj.id, since, limit ?? 50, after))
  );

  tool(
    "project_diff",
    "Compare project state against a point in time. Returns new tickets, title/description/score changes, deleted tickets, and tag changes since the timestamp.",
    {
      ...PROJECT_ARG,
      since: z.string().describe("ISO timestamp to diff from (e.g. '2026-03-10T00:00:00Z')"),
    },
    READ,
    ({ project, since }) =>
      inProject(project, (db, proj) => getProjectDiff(db, proj.id, since))
  );
}
