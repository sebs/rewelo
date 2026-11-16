import { esc } from "./html.js";
import type { DependencyGraph, GraphNode } from "./dependencies.js";

// The dependency graph as inline SVG, left to right: a ticket stands one
// column after the deepest ticket it waits for. Red edges are inversions,
// a ticket waiting for one with a lower priority. Each ticket's details are
// a tooltip (an SVG title), as in the cumulative flow: no script.

const NODE_WIDTH = 200;
const NODE_HEIGHT = 46;
const COLUMN_GAP = 70;
const ROW_GAP = 16;
const PAD = 12;
const TITLE_CHARACTERS = 26;

const x = (n: GraphNode) => PAD + n.layer * (NODE_WIDTH + COLUMN_GAP);
const y = (n: GraphNode) => PAD + n.row * (NODE_HEIGHT + ROW_GAP);

/** At most max characters (not UTF-16 units), with an ellipsis when cut */
function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The graph's picture; it needs at least one node */
export function dependencyGraphSvg(graph: DependencyGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const columns = Math.max(...graph.nodes.map((n) => n.layer)) + 1;
  const rows = Math.max(...graph.nodes.map((n) => n.row)) + 1;
  const width = 2 * PAD + columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP;
  const height = 2 * PAD + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;

  const edges = graph.edges.map((e) => {
    const from = byId.get(e.from)!;
    const to = byId.get(e.to)!;
    const sx = x(from) + NODE_WIDTH;
    const sy = y(from) + NODE_HEIGHT / 2;
    const tx = x(to);
    const ty = y(to) + NODE_HEIGHT / 2;
    const bend = Math.max(30, (tx - sx) / 2);
    const what = `${to.title} waits for ${from.title}${e.inversion ? ", which has a lower priority" : ""}`;
    return (
      `<path class="edge${e.inversion ? " inversion" : ""}" d="M${sx} ${sy}C${sx + bend} ${sy} ${tx - bend} ${ty} ${tx - 6} ${ty}" ` +
      `marker-end="url(#dep-${e.inversion ? "inversion" : "arrow"})"><title>${esc(what)}</title></path>`
    );
  });

  const nodes = graph.nodes.map((n) => {
    const waitingFor = graph.edges.filter((e) => e.to === n.id).map((e) => byId.get(e.from)!.title);
    const tip = [
      `${n.title}: priority ${n.priority.toFixed(2)} (#${n.rank})${n.inProgress ? ", in progress" : ""}`,
      `holds up ${plural(n.holdsUp, "open ticket")}`,
      ...(waitingFor.length > 0 ? [`waits for ${waitingFor.join(", ")}`] : []),
    ].join("; ");
    const sub = `#${n.rank} · ${n.priority.toFixed(2)}${n.holdsUp > 0 ? ` · holds up ${n.holdsUp}` : ""}`;
    return (
      `<g class="node${n.inProgress ? " wip" : ""}" transform="translate(${x(n)} ${y(n)})"><title>${esc(tip)}</title>` +
      `<rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="6"/>` +
      `<text x="10" y="19">${esc(shorten(n.title, TITLE_CHARACTERS))}</text>` +
      `<text class="sub" x="10" y="36">${esc(sub)}</text></g>`
    );
  });

  const marker = (id: string) =>
    `<marker id="dep-${id}" class="${id}" viewBox="0 0 10 10" refX="4" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z"/></marker>`;

  return (
    `<svg class="deps" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" ` +
    `aria-label="${esc(`Dependencies between ${plural(graph.nodes.length, "open ticket")}, left to right; the inversions are listed below`)}">` +
    `<defs>${marker("arrow")}${marker("inversion")}</defs>` +
    edges.join("") +
    nodes.join("") +
    `</svg>`
  );
}
