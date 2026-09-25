import { z } from "zod";
import { getProjectTimes, timesReport } from "../../reports/times.js";
import { getProjectDiff } from "../../reports/diff.js";
import { getDistribution } from "../../reports/distribution.js";
import { getEventLog } from "../../reports/event-log.js";
import { groupByTagPrefix } from "../../reports/group.js";
import { getBacklogHealth } from "../../reports/health.js";
import { getProjectSummary } from "../../reports/summary.js";
import { validateTagPrefix } from "../../validation/strings.js";
import { dashboard, documentOrLink, resourceUri } from "../documents.js";
import { safe } from "../results.js";
import { READ, type McpContext } from "../toolkit.js";

export function registerReportTools(ctx: McpContext): void {
  const { tool, withProject, resolveProject } = ctx;

  tool(
    "report_summary",
    "Get project overview: total tickets, breakdown by state tag, and the top-N open (not state:done) tickets by priority. Good starting point for any project.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      topN: z.number().int().nonnegative().optional().describe("Number of top tickets"),
    },
    READ,
    safe(({ project, topN }) =>
      withProject(resolveProject(project), (db, proj) => getProjectSummary(db, proj.id, topN ?? 5))
    )
  );

  tool(
    "report_times",
    "Calculate lead time (created→done) and cycle time (wip→done) per ticket, plus their averages (whole days; null where there is no value). Prerequisite: assign state:wip and state:done tags to tickets.",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const times = await getProjectTimes(db, proj.id);
        return timesReport(times);
      })
    )
  );

  tool(
    "report_health",
    "Assess backlog health: high/low priority ratio, open ticket count, total cost. highToLowRatio is null when all tickets are high priority.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      threshold: z.number().optional().describe("High priority threshold (default 1.5), compared with the exact value/cost, not the rounded priority"),
    },
    READ,
    safe(({ project, threshold }) =>
      withProject(resolveProject(project), (db, proj) => getBacklogHealth(db, proj.id, threshold ?? 1.5))
    )
  );

  tool(
    "report_distribution",
    "Count how many tickets use each Fibonacci score (1-21), per dimension (benefit, penalty, estimate, risk).",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => getDistribution(db, proj.id)))
  );

  tool(
    "report_group",
    "Group tickets by the values of one tag prefix (e.g. team), with ticket count and average priority per value.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix to group by"),
    },
    READ,
    safe(async ({ project, prefix }) => {
      const validPrefix = validateTagPrefix(prefix);
      return withProject(resolveProject(project), (db, proj) => groupByTagPrefix(db, proj.id, validPrefix));
    })
  );

  tool(
    "report_dashboard",
    "Render a self-contained HTML dashboard (tickets, distribution, health, relations). Returns the HTML document as text, or, when it is over 5 MB, a link to the resource with it.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      limit: z.number().int().nonnegative().optional().describe("Rows per table (default 500)"),
    },
    READ,
    safe(({ project, limit }) =>
      withProject(resolveProject(project), (db, proj) =>
        documentOrLink(
          () => dashboard(db, proj, limit),
          resourceUri(proj.name, limit === undefined ? "dashboard" : `dashboard/${limit}`),
          "dashboard",
          "text/html"
        )
      )
    )
  );


  tool(
    "event_log",
    "Get a unified event stream combining ticket creates, updates, deletes, and tag changes. Without since/after: the newest events, newest first. With since or after: the events after it, oldest first. To poll incrementally without missing events, pass the sequence of the last event received as the next after.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().optional().describe("Only events after this ISO timestamp (then oldest first)"),
      after: z.number().int().nonnegative().optional().describe("Only events written after this sequence number (an earlier event's sequence), in write order"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of events to return (default 50)"),
    },
    READ,
    safe(({ project, since, after, limit }) =>
      withProject(resolveProject(project), (db, proj) => getEventLog(db, proj.id, since, limit ?? 50, after))
    )
  );

  tool(
    "project_diff",
    "Compare project state against a point in time. Returns new tickets, title/description/score changes, deleted tickets, and tag changes since the timestamp.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().describe("ISO timestamp to diff from (e.g. '2026-03-10T00:00:00Z')"),
    },
    READ,
    safe(({ project, since }) =>
      withProject(resolveProject(project), (db, proj) => getProjectDiff(db, proj.id, since))
    )
  );
}
