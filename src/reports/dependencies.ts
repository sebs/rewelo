import { DB } from "../db/connection.js";
import { openBlockerTickets } from "../relations/blocking.js";
import { wipTicketIds } from "../workflow/states.js";

// The open tickets that block others, or wait for others (blocks,
// depends-on, as in relations/blocking.ts), as a graph for the dashboard:
// which chains there are, which tickets hold up the most work, and where a
// ticket waits for one that ranks lower, which the ranking alone hides.

/** The most tickets drawn: a larger graph is unreadable; the highest-ranked are kept */
export const MAX_GRAPH_NODES = 80;

export interface GraphNode {
  id: number;
  title: string;
  /** value / cost, as the dashboard ranks */
  priority: number;
  /** Place among the open tickets by priority, from 1 */
  rank: number;
  /** Holds state:wip now */
  inProgress: boolean;
  /** Open tickets it holds up, directly or through others */
  holdsUp: number;
  /** Column (0: waits for nothing shown) and row in the layout */
  layer: number;
  row: number;
}

export interface GraphEdge {
  /** The blocker */
  from: number;
  /** The ticket waiting for it */
  to: number;
  /** The waiting ticket has a higher priority than its blocker (a tie isn't one) */
  inversion: boolean;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Open tickets in a blocking relation, before MAX_GRAPH_NODES */
  total: number;
}

/**
 * The graph among open tickets; ranked is every open ticket, highest
 * priority first (the dashboard's ranking), so the graph agrees with it.
 */
export async function getDependencyGraph(
  db: DB,
  projectId: number,
  ranked: Array<{ id: number; title: string; priority: number }>
): Promise<DependencyGraph> {
  const blockers = await openBlockerTickets(db, projectId);
  const rankOf = new Map(ranked.map((t, i) => [t.id, i]));
  const allEdges: Array<{ from: number; to: number }> = [];
  for (const [blocked, list] of blockers) for (const b of list) allEdges.push({ from: b.id, to: blocked });

  const involved = new Set(allEdges.flatMap((e) => [e.from, e.to]).filter((id) => rankOf.has(id)));
  const kept = new Set([...involved].sort((a, b) => rankOf.get(a)! - rankOf.get(b)!).slice(0, MAX_GRAPH_NODES));
  const edges = allEdges.filter((e) => kept.has(e.from) && kept.has(e.to));

  const waitsFor = new Map<number, number[]>();
  const holds = new Map<number, number[]>();
  const add = (map: Map<number, number[]>, key: number, value: number) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const e of edges) {
    add(waitsFor, e.to, e.from);
    add(holds, e.from, e.to);
  }

  // Layers: one after the deepest blocker (Kahn's order); a cycle, which
  // the relations shouldn't have, goes into a last layer instead of looping
  const layer = new Map<number, number>();
  const pending = new Map([...kept].map((id) => [id, (waitsFor.get(id) ?? []).length]));
  let ready = [...kept].filter((id) => pending.get(id) === 0);
  while (ready.length > 0) {
    const next: number[] = [];
    for (const id of ready) {
      const depth = Math.max(-1, ...(waitsFor.get(id) ?? []).map((b) => layer.get(b) ?? -1)) + 1;
      layer.set(id, depth);
      for (const w of holds.get(id) ?? []) {
        pending.set(w, pending.get(w)! - 1);
        if (pending.get(w) === 0) next.push(w);
      }
    }
    ready = next;
  }
  const deepest = Math.max(-1, ...layer.values());
  for (const id of kept) if (!layer.has(id)) layer.set(id, deepest + 1);

  // Rows: within a layer, near the tickets it waits for (their mean row),
  // then by rank
  const row = new Map<number, number>();
  const layers = Math.max(-1, ...layer.values()) + 1;
  for (let l = 0; l < layers; l++) {
    const inLayer = [...kept].filter((id) => layer.get(id) === l);
    const near = (id: number) => {
      const rows = (waitsFor.get(id) ?? []).map((b) => row.get(b)).filter((r): r is number => r !== undefined);
      return rows.length === 0 ? Infinity : rows.reduce((s, r) => s + r, 0) / rows.length;
    };
    inLayer.sort((a, b) => near(a) - near(b) || rankOf.get(a)! - rankOf.get(b)!);
    inLayer.forEach((id, i) => row.set(id, i));
  }

  // Held up, directly or through others: everything reachable downstream
  const holdsUp = (id: number) => {
    const seen = new Set<number>();
    const stack = [...(holds.get(id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(holds.get(next) ?? []));
    }
    seen.delete(id);
    return seen.size;
  };

  const wip = await wipTicketIds(db, projectId);
  const nodes = [...kept]
    .sort((a, b) => rankOf.get(a)! - rankOf.get(b)!)
    .map((id) => {
      const t = ranked[rankOf.get(id)!];
      return { id, title: t.title, priority: t.priority, rank: rankOf.get(id)! + 1, inProgress: wip.has(id), holdsUp: holdsUp(id), layer: layer.get(id)!, row: row.get(id)! };
    });
  return {
    nodes,
    edges: edges.map((e) => ({ ...e, inversion: ranked[rankOf.get(e.to)!].priority > ranked[rankOf.get(e.from)!].priority })),
    total: involved.size,
  };
}
