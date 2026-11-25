import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { byPriority, cost, priority, value } from "../calculations/priority.js";
import { getDistribution, type DimensionDistribution } from "./distribution.js";
import { getBacklogHealth, highToLowRatioText, type BacklogHealth } from "./health.js";
import { doneTicketIds } from "../workflow/states.js";
import { listProjectRelations, type ProjectRelationView } from "../relations/repository.js";
import { getWeights } from "../weights/repository.js";
import { FIBONACCI } from "../domain/scores.js";
import { DEFAULT_WEIGHTS } from "../domain/weights.js";
import { esc } from "./html.js";
import {
  cumulativeFlow,
  DEFAULT_FLOW_MEASURE,
  DEFAULT_FLOW_WINDOW,
  FLOW_MEASURES,
  FLOW_WINDOWS,
  flowEventsIn,
  getScoredFlowEvents,
  type FlowMeasure,
  type FlowWindow,
} from "./flow.js";
import { FLOW_MEASURE_LABELS, FLOW_SERIES, flowChartSvg, flowSummary } from "./flow-chart.js";
import { forecastFromDaily, forecastText, dailyDone, DEFAULT_HISTORY_DAYS, type Forecast } from "./forecast.js";
import { getDependencyGraph, type DependencyGraph } from "./dependencies.js";
import { dependencyGraphSvg } from "./dependency-graph.js";
import { DEFAULT_CHANGE_DAYS, getRankingChanges, rankMove, type RankingChanges } from "./ranking-changes.js";
import { browserButton, browserCss, browserHtml, getTicketBrowser, type TicketBrowser } from "./ticket-browser.js";

export interface DashboardOptions {
  /** ISO timestamp shown in the header; omit to leave it blank. */
  generatedAt?: string;
  /** Rows shown in the ticket and relation tables (default 500). */
  limit?: number;
  /** How the reader raises the limit, in HTML (default: the CLI's --limit). */
  limitHint?: string;
  /** The data version it shows (DataChanges), for a live page to compare with the current one */
  version?: string;
  /**
   * For rw report dashboard --watch: the script file, next to the page, that
   * says the current version. The page loads it every few seconds and
   * reloads when the version differs. Without it the page has no script.
   */
  reloadFrom?: string;
}

/** A page stays usable in a browser: 30,000 rows made an 8 MB document */
export const DEFAULT_DASHBOARD_LIMIT = 500;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;


export interface DashboardRelation extends ProjectRelationView {
  sourceDone: boolean;
  targetDone: boolean;
}

export interface DashboardModel {
  projectName: string;
  /** Open tickets (not state:done), highest priority first */
  rows: Array<{ title: string; benefit: number; penalty: number; estimate: number; risk: number; value: number; cost: number; priority: number }>;
  doneCount: number;
  /** Whether the project's weights differ from the defaults (the table shows unweighted priority) */
  customWeights: boolean;
  distribution: DimensionDistribution[];
  health: BacklogHealth;
  /** Every relation, with whether either ticket is done (the card can hide those) */
  relations: DashboardRelation[];
  /** The cumulative flow, one window per FLOW_WINDOWS entry and FLOW_MEASURES entry; no points without tickets */
  flow: FlowWindow[];
  /** When the open tickets will be done, at the recent pace */
  forecast?: Forecast;
  /** Which open tickets block which */
  dependencies?: DependencyGraph;
  /** What changed in the ranking in the last DEFAULT_CHANGE_DAYS days */
  rankingChanges?: RankingChanges;
  /** Every ticket, done ones too, for the ticket browser */
  browser?: TicketBrowser;
}

/** What the dashboard shows, read from the database; the flow ends on now's day */
export async function buildDashboardModel(
  db: DB,
  projectId: number,
  projectName: string,
  now: Date = new Date(),
  limit: number = DEFAULT_DASHBOARD_LIMIT
): Promise<DashboardModel> {
  const tickets = (await listTickets(db, projectId, { withDescription: false })).sort(byPriority);
  // The ranking is what to do next: open tickets only, as the health cards count
  const done = await doneTicketIds(db, projectId);
  const open = tickets.filter((t) => !done.has(t.id));
  const rows = open.map((t) => ({
      title: t.title,
      benefit: t.benefit,
      penalty: t.penalty,
      estimate: t.estimate,
      risk: t.risk,
      value: value(t),
      cost: cost(t),
      priority: priority(t),
    }));

  const weights = await getWeights(db, projectId);
  const customWeights = (["w1", "w2", "w3", "w4"] as const).some((w) => weights[w] !== DEFAULT_WEIGHTS[w]);
  const distribution = await getDistribution(db, projectId);
  const health = await getBacklogHealth(db, projectId);
  const projectRelations = await listProjectRelations(db, projectId);
  const relations = projectRelations.map((r) => ({
    ...r,
    sourceDone: done.has(r.source_id),
    targetDone: done.has(r.target_id),
  }));
  const scored = await getScoredFlowEvents(db, projectId);
  const events = flowEventsIn(scored, "count");
  const flow = FLOW_MEASURES.flatMap((measure) => {
    const measured = measure === "count" ? events : flowEventsIn(scored, measure);
    return FLOW_WINDOWS.map((days) => cumulativeFlow(measured, days, now));
  });
  // From the done times the flow already read
  const forecast = forecastFromDaily(dailyDone(events.done, DEFAULT_HISTORY_DAYS, now), rows.length, now);
  const dependencies = await getDependencyGraph(db, projectId, open.map((t) => ({ id: t.id, title: t.title, priority: priority(t) })));

  const rankingChanges = await getRankingChanges(db, projectId, undefined, now);
  const browser = await getTicketBrowser(db, projectId, tickets, projectRelations, done, limit);

  return { projectName, rows, doneCount: done.size, customWeights, distribution, health, relations, flow, forecast, dependencies, rankingChanges, browser };
}

/**
 * Render a self-contained HTML dashboard (no external assets) with backlog
 * health, the cumulative flow, a priority table, the Fibonacci score
 * distribution and the ticket relationship/dependency list.
 */
export async function renderDashboard(
  db: DB,
  projectId: number,
  projectName: string,
  options: DashboardOptions = {}
): Promise<string> {
  const now = options.generatedAt ? new Date(options.generatedAt) : new Date();
  return renderDashboardHtml(await buildDashboardModel(db, projectId, projectName, now, options.limit ?? DEFAULT_DASHBOARD_LIMIT), options);
}

const windowId = (days: number) => `flow-${days > 0 ? days : "all"}`;
const windowName = (days: number) => (days > 0 ? `${days} days` : "All");
const measureId = (measure: FlowMeasure) => `measure-${measure}`;
const DEFAULT_CHART = `.${windowId(DEFAULT_FLOW_WINDOW)}.${measureId(DEFAULT_FLOW_MEASURE)}`;

// The switches work without a script, which the MCP App page would not run:
// a radio button per window and per measure, and :has() shows the chart of
// the checked pair. A browser without :has() shows the default chart.
const flowWindowCss = [
  `.flow { display: none; margin: 0; }`,
  `.flow-card ${DEFAULT_CHART} { display: block; }`,
  `.flow-card:has(.window input:checked:not(#${windowId(DEFAULT_FLOW_WINDOW)})) ${DEFAULT_CHART},` +
    ` .flow-card:has(.measure input:checked:not(#${measureId(DEFAULT_FLOW_MEASURE)})) ${DEFAULT_CHART} { display: none; }`,
  ...FLOW_MEASURES.flatMap((measure) =>
    FLOW_WINDOWS.map(
      (days) =>
        `.flow-card:has(#${windowId(days)}:checked):has(#${measureId(measure)}:checked) .${windowId(days)}.${measureId(measure)} { display: block; }`
    )
  ),
].join("\n  ");

/** A radio button, styled as a button by its label */
const radio = (name: string, id: string, label: string, checked: boolean) =>
  `<input type="radio" name="${name}" id="${id}"${checked ? " checked" : ""}><label for="${id}">${label}</label>`;

/** The cumulative flow card: a chart per window and measure, and the switches between them */
function flowSection(flow: FlowWindow[], forecast?: Forecast): string {
  const head = `<h2 id="flow">Cumulative flow</h2>`;
  if (flow.every((w) => w.points.length === 0)) {
    return `<section class="card flow-card" aria-labelledby="flow">${head}<p class="empty">No tickets to chart yet.</p></section>`;
  }
  const windows = FLOW_WINDOWS.map((days) => radio("flow-window", windowId(days), windowName(days), days === DEFAULT_FLOW_WINDOW)).join("");
  const measures = FLOW_MEASURES.map((measure) => {
    const { label, name } = FLOW_MEASURE_LABELS[measure];
    // B, P, E and R spelt out, as in the ticket table
    const text = label.length === 1 ? `<abbr title="${name[0].toUpperCase()}${name.slice(1)}">${label}</abbr>` : label;
    return radio("flow-measure", measureId(measure), text, measure === DEFAULT_FLOW_MEASURE);
  }).join("");
  const charts = flow
    .map(
      (w) => `<figure class="flow ${windowId(w.days)} ${measureId(w.measure)}">
    ${flowChartSvg(w)}
    <figcaption>${esc(flowSummary(w))}</figcaption>
  </figure>`
    )
    .join("\n  ");
  const legend = FLOW_SERIES.map(
    (s) => `<li><span class="swatch ${s.key}"></span>${s.label} <span class="muted">(${esc(s.description)})</span></li>`
  ).join("");
  return `<section class="card flow-card" aria-labelledby="flow">
  <div class="card-head">
    ${head}
    <div class="switches">
      <fieldset class="window"><legend>Window</legend>${windows}</fieldset>
      <fieldset class="window measure"><legend>Measure</legend>${measures}</fieldset>
    </div>
  </div>
  <p class="meta">Tickets that have arrived, started and are done, counted at the end of each day (UTC); by a measure, the sum of the tickets' scores (as they are scored now). Hover a day for its numbers.</p>
  ${charts}
  <ul class="legend">${legend}</ul>
  ${forecast ? `<p class="forecast"><strong>Forecast:</strong> ${esc(forecastText(forecast))}</p>` : ""}
</section>`;
}

/** Ranking changes shown on the dashboard: a summary; the report lists them all */
export const DASHBOARD_CHANGES = 20;

/** The ranking changes card: the tickets with a change of their own */
function changesSection(report: RankingChanges, limit: number): string {
  const head = `<h2 id="changes">Ranking changes in the last ${DEFAULT_CHANGE_DAYS} days</h2>`;
  const notes = [
    ...(report.shifted > 0 ? [`${report.shifted} other ${report.shifted === 1 ? "ticket" : "tickets"} moved only because these did.`] : []),
    ...(report.deleted.length > 0 ? [`Deleted: ${report.deleted.map(esc).join(", ")}.`] : []),
    ...(report.changes.length > limit ? [`Showing ${limit} of ${report.changes.length} changes; <code>rw report changes</code> or <code>report_changes</code> lists them all.`] : []),
  ].map((n) => `<p class="meta">${n}</p>`).join("");
  if (report.changes.length === 0) {
    return `<section class="card" aria-labelledby="changes">${head}<p class="empty">No ticket changed rank for a reason of its own.</p>${notes}</section>`;
  }
  const rows = report.changes
    .slice(0, limit)
    .map((c) => `<tr><td>${esc(c.title)}</td><td class="move">${esc(rankMove(c))}</td><td>${esc(c.reasons.join("; "))}</td></tr>`)
    .join("");
  return `<section class="card" aria-labelledby="changes">
  ${head}
  <p class="meta">Open tickets by priority, as in the table above, then and now, with what changed about each.</p>
  <div class="scroll">
  <table aria-labelledby="changes">
    <thead><tr><th scope="col">Ticket</th><th scope="col">Rank</th><th scope="col">Why</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
  ${notes}
</section>`;
}

/** The dependency graph card, with the inversions in words below the picture */
function dependencySection(graph: DependencyGraph): string {
  const head = `<h2 id="dependencies">Dependencies</h2>`;
  if (graph.nodes.length === 0) {
    return `<section class="card" aria-labelledby="dependencies">${head}<p class="empty">No open ticket blocks another.</p></section>`;
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const named = (id: number) => {
    const n = byId.get(id)!;
    return `<strong>${esc(n.title)}</strong> (#${n.rank}, ${n.priority.toFixed(2)})`;
  };
  const inversions = graph.edges.filter((e) => e.inversion);
  const inversionList =
    inversions.length === 0
      ? `<p class="meta">No ticket waits for one with a lower priority.</p>`
      : `<p class="meta">${inversions.length === 1 ? "A ticket waits" : `${inversions.length} tickets wait`} for one with a lower priority:</p>
  <ul class="inversions">${inversions.map((e) => `<li>${named(e.to)} waits for ${named(e.from)}</li>`).join("")}</ul>`;
  const more =
    graph.total > graph.nodes.length
      ? `<p class="meta">Showing the ${graph.nodes.length} highest-ranked of ${graph.total} tickets with dependencies.</p>`
      : "";
  return `<section class="card" aria-labelledby="dependencies">
  ${head}
  <p class="meta">Open tickets that block others (blocks, depends-on), left to right: each waits for the ones before it. The rank and priority are the table's; "holds up" counts the open tickets waiting for it, directly or through others.</p>
  <div class="scroll">${dependencyGraphSvg(graph)}</div>
  <ul class="legend"><li><span class="swatch node-open"></span>Not started</li><li><span class="swatch node-wip"></span>In progress</li><li><span class="swatch inverted"></span>Waits for a lower priority</li></ul>
  ${inversionList}
  ${more}
</section>`;
}

/** A health figure; share, when given, as a bar under it (0 to 1) */
function stat(label: string, value: string | number, accent: string, share?: number): string {
  const bar =
    share === undefined
      ? ""
      : `<span class="bar" aria-hidden="true"><span class="fill" style="width: ${Math.round(share * 100)}%"></span></span>`;
  return `<div class="stat ${accent}"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span>${bar}</div>`;
}

/** How often a page written by --watch looks for a new version */
export const RELOAD_CHECK_MS = 2000;

// A page opened from a file can't fetch another file, but it can load one as
// a script: the version file calls reweloDashboardVersion("…"). The choices
// made on the page (the flow's window, switches, the ticket browser's filter
// and page) and the dialogs open survive the reload in sessionStorage; the
// browser keeps the scroll position.
function reloadScript(versionFile: string): string {
  // JSON is valid JavaScript; "<" escaped so a file name can't end the script
  const src = JSON.stringify(versionFile).replace(/</g, "\\u003c");
  return `<script>
(() => {
  const key = "rewelo-dashboard-choices";
  const dialogsKey = "rewelo-dashboard-dialogs";
  const shown = document.querySelector('meta[name="rewelo-version"]').content;
  const choices = () => [...document.querySelectorAll("input[id]")]
    .filter((input) => input.type === "radio" || input.type === "checkbox")
    .map((input) => [input.id, input.checked]);
  try {
    for (const [id, checked] of JSON.parse(sessionStorage.getItem(key) || "[]")) {
      const input = document.getElementById(id);
      if (input) input.checked = checked;
    }
    // The dialogs open before the reload, in the order they were opened
    for (const id of JSON.parse(sessionStorage.getItem(dialogsKey) || "[]")) {
      const dialog = document.getElementById(id);
      if (dialog && dialog.showModal && !dialog.open) dialog.showModal();
    }
    sessionStorage.removeItem(dialogsKey);
  } catch {
    // No session storage (blocked): the defaults it is
  }
  document.addEventListener("change", () => {
    try { sessionStorage.setItem(key, JSON.stringify(choices())); } catch { /* as above */ }
  });
  window.reweloDashboardVersion = (version) => {
    if (version === shown) return;
    try {
      sessionStorage.setItem(dialogsKey, JSON.stringify([...document.querySelectorAll("dialog[open]")].map((dialog) => dialog.id)));
    } catch { /* as above */ }
    location.reload();
  };
  setInterval(() => {
    if (document.hidden) return;
    const script = document.createElement("script");
    script.src = ${src} + "?" + Date.now();
    script.onload = script.onerror = () => script.remove();
    document.head.append(script);
  }, ${RELOAD_CHECK_MS});
})();
</script>`;
}

/** The dashboard's HTML for a model: no database needed */
export function renderDashboardHtml(model: DashboardModel, options: DashboardOptions = {}): string {
  const { projectName, rows, doneCount, customWeights, distribution, health, relations, flow } = model;
  const limit = options.limit ?? DEFAULT_DASHBOARD_LIMIT;
  const priorityRows =
    rows
      .slice(0, limit)
      // One line a row: the indentation took a tenth of a dashboard of 12,000 rows
      .map(
        (t) =>
          `<tr><td>${esc(t.title)}</td><td class="n">${t.benefit}</td><td class="n">${t.penalty}</td><td class="n">${t.estimate}</td>` +
          `<td class="n">${t.risk}</td><td class="n">${t.value}</td><td class="n">${t.cost}</td><td class="n strong">${t.priority.toFixed(2)}</td></tr>`
      )
      .join("") +
    // Only when there are none: with --limit 0 the note below says how many
    (rows.length === 0
      ? `<tr><td colspan="8" class="empty">${doneCount > 0 ? "No open tickets." : "No tickets yet."}</td></tr>`
      : "");

  const distRows = distribution
    .map(
      (d) =>
        `<tr><th scope="row">${esc(d.dimension)}</th>${FIBONACCI.map(
          (f) => `<td class="n">${d.counts[f] || 0}</td>`
        ).join("")}</tr>`
    )
    .join("");

  const shownRelations = relations.slice(0, limit);
  const relationRows =
    shownRelations
      .map((r) => {
        const title = (text: string, done: boolean) => `${esc(text)}${done ? ` <span class="badge">done</span>` : ""}`;
        const open = !r.sourceDone && !r.targetDone;
        return `<tr${open ? "" : ` class="closed"`}><td>${title(r.source_title, r.sourceDone)}</td><td class="rel">${esc(
          r.relation_type
        )}</td><td>${title(r.target_title, r.targetDone)}</td></tr>`;
      })
      .join("") +
    (relations.length === 0 ? `<tr><td colspan="3" class="empty">No relations defined.</td></tr>` : "") +
    // Shown by the switch when every row it would show is hidden
    (shownRelations.length > 0 && shownRelations.every((r) => r.sourceDone || r.targetDone)
      ? `<tr class="none-open"><td colspan="3" class="empty">No relation between open tickets.</td></tr>`
      : "");

  // Says what a capped table leaves out
  const more = (shown: number, total: number, what: string) =>
    total > shown
      ? `<p class="meta">Showing ${shown} of ${plural(total, what)}; ${options.limitHint ?? "<code>rw report dashboard --limit</code>"} shows more.</p>`
      : "";

  const generated = options.generatedAt
    ? `<p class="generated">Generated ${esc(options.generatedAt)}</p>`
    : "";

  const total = health.totalTickets;
  const shareOfAll = (n: number) => (total > 0 ? n / total : 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(projectName)} — Rewelo dashboard</title>
<meta name="rewelo-project" content="${esc(projectName)}">
${options.limit !== undefined ? `<meta name="rewelo-limit" content="${options.limit}">\n` : ""}${options.version !== undefined ? `<meta name="rewelo-version" content="${esc(options.version)}">\n` : ""}<style>
  /* The look of DevOps Infinity's dashboard: a purple bar, cards on a dark
     ground, teal, orange, blue and red accents; light when the reader (or
     the MCP host) is. light-dark() follows color-scheme, which the MCP App
     page sets to the host's theme. Text meets WCAG AA contrast in both. */
  :root {
    color-scheme: light dark;
    --bg: light-dark(#f5f5f8, #1a1a20);
    --card: light-dark(#ffffff, #222229);
    --inset: light-dark(#f1f1f5, #2a2a33);
    --line: light-dark(#dcdce4, #3e3e48);
    --text: light-dark(#1a1a20, #f3f4f6);
    --muted: light-dark(#5f5f6b, #a3a3ad);
    --hover: light-dark(rgba(26, 26, 32, .06), rgba(255, 255, 255, .08));
    --brand: #5b4ad9;
    --purple: #7563f8;
    --teal: #56d7c6;
    --orange: #ffb36b;
    --blue: #63a1f8;
    --red: #ff6b6b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.4; }
  .page { max-width: 72rem; margin: 0 auto; padding: 1rem; display: grid; gap: 1.25rem; }
  .bar-head { background: var(--brand); color: #fff; border-radius: 8px; padding: .9rem 1.1rem; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .25rem 1rem; }
  h1 { margin: 0; font-size: 1.6rem; }
  .generated { margin: 0; font-size: .85rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; box-shadow: 0 4px 14px rgba(0, 0, 0, .12); min-width: 0; }
  .card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem; }
  h2 { margin: 0 0 .5rem; font-size: 1.15rem; }
  .card-head h2 { margin: 0; }
  .meta { color: var(--muted); margin: .25rem 0 .75rem; font-size: .85rem; }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; }
  .page > * { min-width: 0; }
  .two { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); }

  .stats { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); }
  .stat { background: var(--inset); border-radius: 8px; padding: .6rem .8rem; border-top: 3px solid var(--accent); }
  .stat .k { display: block; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .stat .v { display: block; font-size: 1.5rem; font-weight: 700; }
  .stat .bar { display: block; height: 6px; margin-top: .4rem; border-radius: 999px; background: var(--line); overflow: hidden; }
  .stat .fill { display: block; height: 100%; border-radius: 999px; background: var(--accent); }
  .purple { --accent: var(--purple); }
  .teal { --accent: var(--teal); }
  .orange { --accent: var(--orange); }
  .blue { --accent: var(--blue); }
  .red { --accent: var(--red); }

  .switches { display: grid; gap: .35rem; justify-items: end; }
  .window { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; }
  .window legend { float: left; margin-right: .3rem; font-size: .85rem; color: var(--muted); }
  .switches .window legend { min-width: 4.2rem; text-align: right; }
  .window input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .window label { font-size: .85rem; padding: .2rem .6rem; border-radius: 4px; border: 1px solid var(--line); background: var(--inset); cursor: pointer; }
  .window label:hover { border-color: var(--purple); }
  .window input:checked + label { background: var(--brand); border-color: var(--brand); color: #fff; }
  .window input:focus-visible + label { outline: 2px solid var(--purple); outline-offset: 2px; }
  ${flowWindowCss}
  .flow figcaption { font-size: .9rem; margin-top: .4rem; }
  .cfd { display: block; width: 100%; height: auto; background: var(--inset); border-radius: 8px; }
  .cfd .grid { stroke: var(--line); stroke-width: 1; }
  .cfd .tick { fill: var(--muted); font-size: 11px; font-family: inherit; }
  /* The chart scales with its width: larger type keeps the axis legible on a phone */
  @media (max-width: 40rem) { .cfd .tick { font-size: 24px; } }
  .cfd .area { stroke: none; }
  .cfd .line { fill: none; stroke-width: 1.5; }
  .cfd .hit { fill: transparent; }
  .cfd .hit:hover { fill: var(--hover); }
  .arrived { --series: rgb(117, 99, 248); }
  .started { --series: rgb(249, 115, 22); }
  .done { --series: rgb(59, 130, 246); }
  .cfd .area.arrived { fill: rgba(117, 99, 248, .5); }
  .cfd .area.started { fill: rgba(249, 115, 22, .5); }
  .cfd .area.done { fill: rgba(59, 130, 246, .5); }
  .cfd .line { stroke: var(--series); }
  .forecast { margin: .75rem 0 0; padding: .5rem .75rem; border-left: 3px solid var(--teal); background: var(--inset); border-radius: 4px; font-size: .9rem; }
  .legend { list-style: none; padding: 0; margin: .6rem 0 0; display: flex; flex-wrap: wrap; gap: .4rem 1.25rem; font-size: .9rem; }
  .swatch { display: inline-block; width: .8rem; height: .8rem; border-radius: 2px; margin-right: .4rem; vertical-align: -1px; background: var(--series); }

  .deps { display: block; }
  .deps .edge { fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .deps .edge.inversion { stroke: var(--red); stroke-width: 2.5; }
  .deps marker.arrow path { fill: var(--muted); }
  .deps marker.inversion path { fill: var(--red); }
  .deps .node rect { fill: var(--inset); stroke: var(--purple); stroke-width: 1.5; }
  .deps .node.wip rect { stroke: var(--orange); stroke-width: 2.5; }
  .deps .node:hover rect { fill: var(--hover); }
  .deps text { fill: var(--text); font-size: 12px; font-family: inherit; }
  .deps text.sub { fill: var(--muted); font-size: 11px; }
  .swatch.node-open { background: transparent; border: 2px solid var(--purple); }
  .swatch.node-wip { background: transparent; border: 2px solid var(--orange); }
  .swatch.inverted { background: var(--red); height: .25rem; vertical-align: 3px; }
  .inversions { margin: .25rem 0 0; padding-left: 1.25rem; font-size: .9rem; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin-top: .25rem; font-size: .92rem; }
  th, td { border-bottom: 1px solid var(--line); padding: .4rem .6rem; text-align: left; }
  thead th { background: var(--inset); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  tbody th { font-weight: normal; }
  tbody tr:hover { background: var(--hover); }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.strong { font-weight: 700; }
  td.rel { color: var(--muted); }
  td.move { white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; }
  .badge { display: inline-block; font-size: .7rem; padding: 0 .35rem; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); vertical-align: 1px; }
  .toggle { display: inline-flex; align-items: center; gap: .4rem; font-size: .85rem; color: var(--muted); cursor: pointer; }
  .toggle input { accent-color: var(--brand); margin: 0; }
  /* The switch works without a script, as the flow's window does */
  .relations-card tr.none-open { display: none; }
  .relations-card:has(#relations-open:checked) tr.closed { display: none; }
  .relations-card:has(#relations-open:checked) tr.none-open { display: table-row; }
  abbr { text-decoration: none; }
  footer { color: var(--muted); font-size: .8rem; text-align: center; }

  /* The ticket browser and a ticket's details: dialogs opened without a script */
  .open-browser, .close { font: inherit; font-size: .85rem; color: var(--text); padding: .25rem .7rem; border-radius: 4px; border: 1px solid var(--line); background: var(--inset); cursor: pointer; }
  .open-browser:hover, .close:hover { border-color: var(--purple); }
  .open-browser:focus-visible, .close:focus-visible, button.link:focus-visible { outline: 2px solid var(--purple); outline-offset: 2px; }
  .close { font-size: 1.1rem; line-height: 1; padding: .2rem .5rem; }
  dialog { background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; box-shadow: 0 10px 40px rgba(0, 0, 0, .35); width: min(64rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); }
  dialog::backdrop { background: rgba(10, 10, 16, .55); }
  .ticket-detail { width: min(40rem, calc(100vw - 2rem)); }
  .dialog-head { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
  .dialog-head h2 { margin: 0 0 .5rem; overflow-wrap: anywhere; }
  .browser .window { margin: .25rem 0 .5rem; }
  .browser .pager { margin-top: .6rem; }
  .count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .window input:checked + label .count { color: inherit; opacity: .8; }
  button.link { font: inherit; color: inherit; background: none; border: 0; padding: 0; text-align: left; cursor: pointer; text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
  button.link:hover { color: var(--purple); text-decoration-color: currentColor; }
  h3 { margin: .9rem 0 .35rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .scores { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fill, minmax(4.6rem, 1fr)); margin: .25rem 0 0; }
  .scores div { background: var(--inset); border-radius: 6px; padding: .35rem .6rem; }
  .scores dt { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .scores dd { margin: 0; font-size: 1.15rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .desc { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
  .tags { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: .35rem; }
  .tags .badge { font-size: .8rem; }
  .related { margin: 0; padding-left: 1.25rem; }
  .ticket-detail .empty { margin: 0; }
  .ticket-detail > .meta:last-child { margin: .9rem 0 0; }
  ${model.browser ? browserCss(model.browser) : ""}
</style>
</head>
<body>
<div class="page">
<header class="bar-head">
<h1>${esc(projectName)}</h1>
${generated}
</header>

<section class="card" aria-labelledby="health">
  <h2 id="health">Backlog health</h2>
  <div class="stats">
    ${stat("Total", total, "purple")}
    ${stat("Done", health.doneTickets, "blue", shareOfAll(health.doneTickets))}
    ${stat("Open", health.openTickets, "orange", shareOfAll(health.openTickets))}
    ${stat("High priority", health.highPriorityCount, "teal")}
    ${stat("Low priority", health.lowPriorityCount, "red")}
    ${stat("High:Low", highToLowRatioText(health), "purple")}
    ${stat("Backlog cost", health.totalBacklogCost, "orange")}
  </div>
</section>

${flowSection(flow, model.forecast)}

<section class="card" aria-labelledby="tickets">
  <div class="card-head">
    <h2 id="tickets">Open tickets by priority</h2>
    ${model.browser && model.browser.total > 0 ? browserButton() : ""}
  </div>
  ${doneCount > 0 ? `<p class="meta">${doneCount} done ticket${doneCount === 1 ? " is" : "s are"} not listed.</p>` : ""}
  ${customWeights ? `<p class="meta">Priority is value / cost without the project's weights; <code>rw calc priority</code> shows the weighted priority.</p>` : ""}
  <div class="scroll">
  <table aria-labelledby="tickets">
    <thead><tr><th scope="col">Title</th><th scope="col"><abbr title="Benefit">B</abbr></th><th scope="col"><abbr title="Penalty">P</abbr></th><th scope="col"><abbr title="Estimate">E</abbr></th><th scope="col"><abbr title="Risk">R</abbr></th><th scope="col">Value</th><th scope="col">Cost</th><th scope="col">Priority</th></tr></thead>
    <tbody>${priorityRows}</tbody>
  </table>
  </div>
  ${more(Math.min(limit, rows.length), rows.length, "open ticket")}
</section>

${model.rankingChanges ? changesSection(model.rankingChanges, Math.min(limit, DASHBOARD_CHANGES)) : ""}

${model.dependencies ? dependencySection(model.dependencies) : ""}

<div class="two">
<section class="card" aria-labelledby="distribution">
  <h2 id="distribution">Score distribution</h2>
  <div class="scroll">
  <table aria-labelledby="distribution">
    <thead><tr><th scope="col">Dimension</th>${FIBONACCI.map((f) => `<th scope="col">${f}</th>`).join("")}</tr></thead>
    <tbody>${distRows}</tbody>
  </table>
  </div>
</section>

<section class="card relations-card" aria-labelledby="relations">
  <div class="card-head">
    <h2 id="relations">Relationships</h2>
    <label class="toggle"><input type="checkbox" id="relations-open">Only between open tickets</label>
  </div>
  <div class="scroll">
  <table aria-labelledby="relations">
    <thead><tr><th scope="col">Source</th><th scope="col">Type</th><th scope="col">Target</th></tr></thead>
    <tbody>${relationRows}</tbody>
  </table>
  </div>
  ${more(Math.min(limit, relations.length), relations.length, "relation")}
</section>
</div>

<footer>Generated by Rewelo.</footer>
</div>
${model.browser && model.browser.total > 0 ? browserHtml(model.browser, more(model.browser.tickets.length, model.browser.total, "ticket")) : ""}
${options.reloadFrom !== undefined && options.version !== undefined ? reloadScript(options.reloadFrom) : ""}
</body>
</html>
`;
}
