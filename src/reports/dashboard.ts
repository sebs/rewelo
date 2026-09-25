import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { byPriority, priority } from "../calculations/priority.js";
import { getDistribution } from "./distribution.js";
import { getBacklogHealth } from "./health.js";
import { doneTicketIds } from "../workflow/states.js";
import { listProjectRelations } from "../relations/repository.js";
import { getWeights } from "../weights/repository.js";
import { FIBONACCI } from "../domain/scores.js";
import { DEFAULT_WEIGHTS } from "../domain/weights.js";

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string
  );
}

export interface DashboardOptions {
  /** ISO timestamp shown in the header; omit to leave it blank. */
  generatedAt?: string;
  /** Rows shown in the ticket and relation tables (default 500). */
  limit?: number;
  /** How the reader raises the limit, in HTML (default: the CLI's --limit). */
  limitHint?: string;
}

/** A page stays usable in a browser: 30,000 rows made an 8 MB document */
export const DEFAULT_DASHBOARD_LIMIT = 500;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Render a self-contained HTML dashboard (no external assets) with a
 * priority table, the Fibonacci score distribution, backlog health, and the
 * ticket relationship/dependency list.
 */
export async function renderDashboard(
  db: DB,
  projectId: number,
  projectName: string,
  options: DashboardOptions = {}
): Promise<string> {
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
      value: t.benefit + t.penalty,
      cost: t.estimate + t.risk,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
    }));

  const weights = await getWeights(db, projectId);
  const customWeights = (["w1", "w2", "w3", "w4"] as const).some((w) => weights[w] !== DEFAULT_WEIGHTS[w]);
  const distribution = await getDistribution(db, projectId);
  const health = await getBacklogHealth(db, projectId);
  const relations = await listProjectRelations(db, projectId);

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
      ? `<tr><td colspan="8" class="empty">${done.size > 0 ? "No open tickets." : "No tickets yet."}</td></tr>`
      : "");

  const distRows = distribution
    .map(
      (d) =>
        `<tr><th scope="row">${esc(d.dimension)}</th>${FIBONACCI.map(
          (f) => `<td class="n">${d.counts[f] || 0}</td>`
        ).join("")}</tr>`
    )
    .join("");

  const ratioText =
    health.highToLowRatio !== null
      ? String(health.highToLowRatio)
      : health.highPriorityCount > 0
        ? "n/a (no low-priority tickets)" // same wording as rw report health
        : "n/a";

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
    ? `<p class="meta">Generated ${esc(options.generatedAt)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(projectName)} — Rewelo dashboard</title>
<style>
  /* muted text meets WCAG AA contrast (4.5:1) on the light and dark background */
  :root { color-scheme: light dark; --muted: #595959; }
  @media (prefers-color-scheme: dark) { :root { --muted: #a6a6a6; } }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; line-height: 1.4; }
  h1 { margin: 0 0 .25rem; }
  h2 { margin: 2rem 0 .5rem; font-size: 1.15rem; }
  .meta { color: var(--muted); margin: 0 0 1rem; font-size: .85rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: .75rem 1rem; min-width: 8rem; }
  .card .k { display: block; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .card .v { font-size: 1.5rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { border: 1px solid #8883; padding: .35rem .6rem; text-align: left; }
  th { background: #8882; }
  tbody th { font-weight: normal; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.strong { font-weight: 700; }
  td.rel { color: var(--muted); }
  td.empty { text-align: center; color: var(--muted); font-style: italic; }
  tbody tr:nth-child(even) { background: #8881; }
  footer { margin-top: 2rem; color: var(--muted); font-size: .8rem; }
</style>
</head>
<body>
<h1>${esc(projectName)}</h1>
${generated}

<h2>Backlog health</h2>
<div class="cards">
  <div class="card"><span class="k">Total</span><span class="v">${health.totalTickets}</span></div>
  <div class="card"><span class="k">Done</span><span class="v">${health.doneTickets}</span></div>
  <div class="card"><span class="k">Open</span><span class="v">${health.openTickets}</span></div>
  <div class="card"><span class="k">High priority</span><span class="v">${health.highPriorityCount}</span></div>
  <div class="card"><span class="k">Low priority</span><span class="v">${health.lowPriorityCount}</span></div>
  <div class="card"><span class="k">High:Low</span><span class="v">${ratioText}</span></div>
  <div class="card"><span class="k">Backlog cost</span><span class="v">${health.totalBacklogCost}</span></div>
</div>

<h2 id="tickets">Open tickets by priority</h2>
${done.size > 0 ? `<p class="meta">${done.size} done ticket${done.size === 1 ? " is" : "s are"} not listed.</p>` : ""}
${customWeights ? `<p class="meta">Priority is value / cost without the project's weights; <code>rw calc priority</code> shows the weighted priority.</p>` : ""}
<table aria-labelledby="tickets">
  <thead><tr><th scope="col">Title</th><th scope="col"><abbr title="Benefit">B</abbr></th><th scope="col"><abbr title="Penalty">P</abbr></th><th scope="col"><abbr title="Estimate">E</abbr></th><th scope="col"><abbr title="Risk">R</abbr></th><th scope="col">Value</th><th scope="col">Cost</th><th scope="col">Priority</th></tr></thead>
  <tbody>${priorityRows}</tbody>
</table>
${more(Math.min(limit, rows.length), rows.length, "open ticket")}

<h2 id="distribution">Score distribution</h2>
<table aria-labelledby="distribution">
  <thead><tr><th scope="col">Dimension</th>${FIBONACCI.map((f) => `<th scope="col">${f}</th>`).join("")}</tr></thead>
  <tbody>${distRows}</tbody>
</table>

<h2 id="relations">Relationships</h2>
<table aria-labelledby="relations">
  <thead><tr><th scope="col">Source</th><th scope="col">Type</th><th scope="col">Target</th></tr></thead>
  <tbody>${relationRows}</tbody>
</table>
${more(Math.min(limit, relations.length), relations.length, "relation")}

<footer>Generated by Rewelo.</footer>
</body>
</html>
`;
}
