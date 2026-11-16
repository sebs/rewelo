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
import { cumulativeFlow, DEFAULT_FLOW_WINDOW, FLOW_WINDOWS, getFlowEvents, type FlowWindow } from "./flow.js";
import { FLOW_SERIES, flowChartSvg, flowSummary } from "./flow-chart.js";

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


export interface DashboardModel {
  projectName: string;
  /** Open tickets (not state:done), highest priority first */
  rows: Array<{ title: string; benefit: number; penalty: number; estimate: number; risk: number; value: number; cost: number; priority: number }>;
  doneCount: number;
  /** Whether the project's weights differ from the defaults (the table shows unweighted priority) */
  customWeights: boolean;
  distribution: DimensionDistribution[];
  health: BacklogHealth;
  relations: ProjectRelationView[];
  /** The cumulative flow, one window per FLOW_WINDOWS entry; no points without tickets */
  flow: FlowWindow[];
}

/** What the dashboard shows, read from the database; the flow ends on now's day */
export async function buildDashboardModel(
  db: DB,
  projectId: number,
  projectName: string,
  now: Date = new Date()
): Promise<DashboardModel> {
  const tickets = await listTickets(db, projectId, { withDescription: false });
  // The ranking is what to do next: open tickets only, as the health cards count
  const done = await doneTicketIds(db, projectId);
  const rows = tickets
    .filter((t) => !done.has(t.id))
    .sort(byPriority)
    .map((t) => ({
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
  const relations = await listProjectRelations(db, projectId);
  const events = await getFlowEvents(db, projectId);
  const flow = FLOW_WINDOWS.map((days) => cumulativeFlow(events, days, now));

  return { projectName, rows, doneCount: done.size, customWeights, distribution, health, relations, flow };
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
  return renderDashboardHtml(await buildDashboardModel(db, projectId, projectName, now), options);
}

const windowId = (days: number) => `flow-${days > 0 ? days : "all"}`;
const windowName = (days: number) => (days > 0 ? `${days} days` : "All");

// The window switch works without a script, which the MCP App page would not
// run: a radio button per window, and :has() shows the checked one's chart.
// A browser without :has() shows the default window.
const flowWindowCss = [
  `.flow { display: none; margin: 0; }`,
  `.flow-card .${windowId(DEFAULT_FLOW_WINDOW)} { display: block; }`,
  `.flow-card:has(.window input:checked:not(#${windowId(DEFAULT_FLOW_WINDOW)})) .${windowId(DEFAULT_FLOW_WINDOW)} { display: none; }`,
  ...FLOW_WINDOWS.map((days) => `.flow-card:has(#${windowId(days)}:checked) .${windowId(days)} { display: block; }`),
].join("\n  ");

/** The cumulative flow card: a chart per window and the switch between them */
function flowSection(flow: FlowWindow[]): string {
  const head = `<h2 id="flow">Cumulative flow</h2>`;
  if (flow.every((w) => w.points.length === 0)) {
    return `<section class="card flow-card" aria-labelledby="flow">${head}<p class="empty">No tickets to chart yet.</p></section>`;
  }
  const radios = flow
    .map(
      ({ days }) =>
        `<input type="radio" name="flow-window" id="${windowId(days)}"${days === DEFAULT_FLOW_WINDOW ? " checked" : ""}>` +
        `<label for="${windowId(days)}">${windowName(days)}</label>`
    )
    .join("");
  const charts = flow
    .map(
      (w) => `<figure class="flow ${windowId(w.days)}">
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
    <fieldset class="window"><legend>Window</legend>${radios}</fieldset>
  </div>
  <p class="meta">Tickets that have arrived, started and are done, counted at the end of each day (UTC). Hover a day for its counts.</p>
  ${charts}
  <ul class="legend">${legend}</ul>
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
// a script: the version file calls reweloDashboardVersion("…"). The chosen
// window survives the reload in sessionStorage; the browser keeps the scroll
// position.
function reloadScript(versionFile: string): string {
  // JSON is valid JavaScript; "<" escaped so a file name can't end the script
  const src = JSON.stringify(versionFile).replace(/</g, "\\u003c");
  return `<script>
(() => {
  const key = "rewelo-flow-window";
  const shown = document.querySelector('meta[name="rewelo-version"]').content;
  try {
    const chosen = document.getElementById(sessionStorage.getItem(key) || "");
    if (chosen) chosen.checked = true;
  } catch {
    // No session storage (blocked): the default window it is
  }
  document.addEventListener("change", (event) => {
    if (event.target.name !== "flow-window") return;
    try { sessionStorage.setItem(key, event.target.id); } catch { /* as above */ }
  });
  window.reweloDashboardVersion = (version) => { if (version !== shown) location.reload(); };
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
      .map(
        (t) => `<tr>
        <td>${esc(t.title)}</td>
        <td class="n">${t.benefit}</td>
        <td class="n">${t.penalty}</td>
        <td class="n">${t.estimate}</td>
        <td class="n">${t.risk}</td>
        <td class="n">${t.value}</td>
        <td class="n">${t.cost}</td>
        <td class="n strong">${t.priority.toFixed(2)}</td>
      </tr>`
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

  const relationRows =
    relations
      .slice(0, limit)
      .map(
        (r) =>
          `<tr><td>${esc(r.source_title)}</td><td class="rel">${esc(
            r.relation_type
          )}</td><td>${esc(r.target_title)}</td></tr>`
      )
      .join("") +
    (relations.length === 0 ? `<tr><td colspan="3" class="empty">No relations defined.</td></tr>` : "");

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

  .window { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; }
  .window legend { float: left; margin-right: .3rem; font-size: .85rem; color: var(--muted); }
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
  .legend { list-style: none; padding: 0; margin: .6rem 0 0; display: flex; flex-wrap: wrap; gap: .4rem 1.25rem; font-size: .9rem; }
  .swatch { display: inline-block; width: .8rem; height: .8rem; border-radius: 2px; margin-right: .4rem; vertical-align: -1px; background: var(--series); }

  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin-top: .25rem; font-size: .92rem; }
  th, td { border-bottom: 1px solid var(--line); padding: .4rem .6rem; text-align: left; }
  thead th { background: var(--inset); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  tbody th { font-weight: normal; }
  tbody tr:hover { background: var(--hover); }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.strong { font-weight: 700; }
  td.rel { color: var(--muted); }
  td.empty { text-align: center; }
  abbr { text-decoration: none; }
  footer { color: var(--muted); font-size: .8rem; text-align: center; }
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

${flowSection(flow)}

<section class="card" aria-labelledby="tickets">
  <h2 id="tickets">Open tickets by priority</h2>
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

<section class="card" aria-labelledby="relations">
  <h2 id="relations">Relationships</h2>
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
${options.reloadFrom !== undefined && options.version !== undefined ? reloadScript(options.reloadFrom) : ""}
</body>
</html>
`;
}
