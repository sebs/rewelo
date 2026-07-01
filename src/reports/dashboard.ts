import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { priority } from "../calculations/priority.js";
import { getDistribution } from "./distribution.js";
import { getBacklogHealth } from "./health.js";
import { listProjectRelations } from "../relations/repository.js";

const FIBS = [1, 2, 3, 5, 8, 13, 21];

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
}

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
  const tickets = await listTickets(db, projectId);
  const rows = tickets
    .map((t) => ({
      title: t.title,
      benefit: t.benefit,
      penalty: t.penalty,
      estimate: t.estimate,
      risk: t.risk,
      value: t.benefit + t.penalty,
      cost: t.estimate + t.risk,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
    }))
    .sort((a, b) => b.priority - a.priority);

  const distribution = await getDistribution(db, projectId);
  const health = await getBacklogHealth(db, projectId);
  const relations = await listProjectRelations(db, projectId);

  const priorityRows =
    rows
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
      .join("") ||
    `<tr><td colspan="8" class="empty">No tickets yet.</td></tr>`;

  const distRows = distribution
    .map(
      (d) =>
        `<tr><td>${esc(d.dimension)}</td>${FIBS.map(
          (f) => `<td class="n">${d.counts[f] || 0}</td>`
        ).join("")}</tr>`
    )
    .join("");

  const ratioText =
    health.highToLowRatio !== null
      ? String(health.highToLowRatio)
      : health.highPriorityCount > 0
        ? "&infin;"
        : "n/a";

  const relationRows =
    relations
      .map(
        (r) =>
          `<tr><td>${esc(r.source_title)}</td><td class="rel">${esc(
            r.relation_type
          )}</td><td>${esc(r.target_title)}</td></tr>`
      )
      .join("") ||
    `<tr><td colspan="3" class="empty">No relations defined.</td></tr>`;

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
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; line-height: 1.4; }
  h1 { margin: 0 0 .25rem; }
  h2 { margin: 2rem 0 .5rem; font-size: 1.15rem; }
  .meta { color: #888; margin: 0 0 1rem; font-size: .85rem; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: .75rem 1rem; min-width: 8rem; }
  .card .k { display: block; font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #888; }
  .card .v { font-size: 1.5rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { border: 1px solid #8883; padding: .35rem .6rem; text-align: left; }
  th { background: #8881; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.strong { font-weight: 700; }
  td.rel { color: #888; }
  td.empty { text-align: center; color: #888; font-style: italic; }
  tbody tr:nth-child(even) { background: #8880; }
  footer { margin-top: 2rem; color: #888; font-size: .8rem; }
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

<h2>Priority ranking</h2>
<table>
  <thead><tr><th>Title</th><th>B</th><th>P</th><th>E</th><th>R</th><th>Value</th><th>Cost</th><th>Priority</th></tr></thead>
  <tbody>${priorityRows}</tbody>
</table>

<h2>Score distribution</h2>
<table>
  <thead><tr><th>Dimension</th>${FIBS.map((f) => `<th>${f}</th>`).join("")}</tr></thead>
  <tbody>${distRows}</tbody>
</table>

<h2>Relationships</h2>
<table>
  <thead><tr><th>Source</th><th>Type</th><th>Target</th></tr></thead>
  <tbody>${relationRows}</tbody>
</table>

<footer>Generated by Rewelo.</footer>
</body>
</html>
`;
}
