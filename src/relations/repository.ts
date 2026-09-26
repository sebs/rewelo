import { DB } from "../db/connection.js";
import { ValidationError } from "../errors.js";
import { allRelationTypes, canonicalRelation, forwardTypeNames, getRelationType, storedPair, symmetricTypeNames } from "./types.js";

export interface Relation {
  id: number;
  project_id: number;
  source_id: number;
  target_id: number;
  relation_type: string;
  created_at: string;
}

export interface RelationView {
  id: number;
  relation_type: string;
  ticket_id: number;
  ticket_title: string;
  /** incoming: the other ticket is the relation's source; both: symmetric */
  direction: "outgoing" | "incoming" | "both";
}

// Which ticket of a relation comes first, for the types that order two
// tickets: the source (1) or the target (-1)
const ORDER: Record<string, 1 | -1> = { blocks: 1, precedes: 1, "depends-on": -1 };
const firstOf = (r: Pick<Relation, "source_id" | "target_id" | "relation_type">): number | undefined =>
  r.relation_type in ORDER ? (ORDER[r.relation_type] === 1 ? r.source_id : r.target_id) : undefined;

// The ordering relations that lead from one ticket to another (each
// ticket before the next), or undefined when none do. Searched from both
// ends at once, the smaller side first, each ticket with indexed queries:
// loading every ordering relation for each new one made importing 8,000
// of them take 45 s (a star of them 148 s), and a search from one end walks
// all that follows a ticket, though the other end often has nothing before it
async function orderingPath(db: DB, projectId: number, from: number, to: number): Promise<Relation[] | undefined> {
  const firstIsSource = Object.keys(ORDER).filter((type) => ORDER[type] === 1);
  const firstIsTarget = Object.keys(ORDER).filter((type) => ORDER[type] === -1);
  const types = (list: string[]) => list.map(() => "?").join(", ");
  const second = (r: Relation) => (firstOf(r) === r.source_id ? r.target_id : r.source_id);
  // The relations that put the ticket first (after) or second (before).
  // Two queries in one, each on its own index: with OR, SQLite searched by
  // project only and scanned all of its relations every time
  const related = (ticket: number, side: "first" | "second") => {
    const [bySource, byTarget] = side === "first" ? [firstIsSource, firstIsTarget] : [firstIsTarget, firstIsSource];
    return db.all<Relation>(
      `SELECT * FROM ticket_relations WHERE project_id = ? AND source_id = ? AND relation_type IN (${types(bySource)})
       UNION ALL
       SELECT * FROM ticket_relations WHERE project_id = ? AND target_id = ? AND relation_type IN (${types(byTarget)})`,
      projectId, ticket, ...bySource, projectId, ticket, ...byTarget
    );
  };
  // Per ticket reached, the relation it was reached by
  const forward = new Map<number, Relation | null>([[from, null]]);
  const backward = new Map<number, Relation | null>([[to, null]]);
  const path = (meet: number) => {
    const relations: Relation[] = [];
    for (let r = forward.get(meet); r; r = forward.get(firstOf(r)!)) relations.unshift(r);
    for (let r = backward.get(meet); r; r = backward.get(second(r))) relations.push(r);
    return relations;
  };
  if (from === to) return [];
  let ahead = [from];
  let behind = [to];
  while (ahead.length > 0 && behind.length > 0) {
    // The side that has reached fewer tickets: with a chain behind one end
    // and nothing before the other, that other end ends the search at once
    const forwards = forward.size <= backward.size;
    const next: number[] = [];
    for (const ticket of forwards ? ahead : behind) {
      for (const relation of await related(ticket, forwards ? "first" : "second")) {
        const other = forwards ? second(relation) : firstOf(relation)!;
        const [mine, theirs] = forwards ? [forward, backward] : [backward, forward];
        if (mine.has(other)) continue;
        mine.set(other, relation);
        if (theirs.has(other)) return path(other);
        next.push(other);
      }
    }
    if (forwards) ahead = next;
    else behind = next;
  }
  return undefined;
}

// "C" blocks "A", by titles: "the target blocks the source" read backwards
// when the new relation was given by its inverse name (is-blocked-by)
async function describe(db: DB, relation: Relation): Promise<string> {
  const title = async (id: number) =>
    (await db.all<{ title: string }>(`SELECT title FROM tickets WHERE id = ?`, id))[0]?.title;
  return `"${await title(relation.source_id)}" ${relation.relation_type} "${await title(relation.target_id)}"`;
}

// The stored row for source → target of this type, if any
async function findRelation(
  db: DB,
  projectId: number,
  sourceId: number,
  targetId: number,
  type: string
): Promise<Relation | undefined> {
  const [row] = await db.all<Relation>(
    `SELECT * FROM ticket_relations
     WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
    projectId,
    sourceId,
    targetId,
    type
  );
  return row;
}

/**
 * Whether the relation is stored already, given as createRelation takes it:
 * by an inverse name, or a symmetric one in either order.
 */
export async function relationExists(
  db: DB,
  projectId: number,
  source: number,
  target: number,
  type: string
): Promise<boolean> {
  const { sourceId, targetId, type: relationType } = canonicalRelation(source, target, type);
  const [from, to] = storedPair(sourceId, targetId, getRelationType(relationType));
  return (await findRelation(db, projectId, from, to, relationType)) !== undefined;
}

export async function createRelation(
  db: DB,
  projectId: number,
  source: number,
  target: number,
  type: string
): Promise<Relation> {
  // One write transaction: in parallel processes the duplicate and reverse
  // checks raced the inserts (both A blocks B and B blocks A got stored)
  return db.transaction(async () => {
    const { sourceId, targetId, type: relationType } = canonicalRelation(source, target, type);
    if (sourceId === targetId) {
      throw new ValidationError("A ticket cannot relate to itself");
    }

    // Validate the relation type exists
    const rt = getRelationType(relationType);
    const [normSource, normTarget] = storedPair(sourceId, targetId, rt);

    if (await findRelation(db, projectId, normSource, normTarget, relationType)) {
      throw new ValidationError("Relation already exists");
    }

    // An asymmetric relation in both directions contradicts itself
    // (A blocks B and B blocks A)
    if (!rt.symmetric) {
      const reverse = await findRelation(db, projectId, targetId, sourceId, relationType);
      if (reverse) {
        throw new ValidationError(`The reverse relation already exists: ${await describe(db, reverse)}`);
      }
    }

    // Relations that order two tickets must agree across types: A blocks B
    // and A depends-on B say opposite things
    const first = firstOf({ source_id: sourceId, target_id: targetId, relation_type: relationType });
    if (first !== undefined) {
      const inOrder = `relation_type IN (${Object.keys(ORDER).map(() => "?").join(", ")})`;
      const ordering = await db.all<Relation>(
        `SELECT * FROM ticket_relations WHERE project_id = ? AND source_id = ? AND target_id = ? AND ${inOrder}
         UNION ALL
         SELECT * FROM ticket_relations WHERE project_id = ? AND source_id = ? AND target_id = ? AND ${inOrder}`,
        projectId, sourceId, targetId, ...Object.keys(ORDER),
        projectId, targetId, sourceId, ...Object.keys(ORDER)
      );
      const opposite = ordering.find((r) => firstOf(r) !== first);
      if (opposite) {
        throw new ValidationError(`This contradicts an existing relation: ${await describe(db, opposite)}`);
      }
      // Nor may they close a cycle through other tickets (A blocks B, B
      // blocks C, C blocks A): no ticket in it could be started first
      const path = await orderingPath(db, projectId, first === sourceId ? targetId : sourceId, first);
      if (path) {
        // A long path named in part: a cycle through 2,000 tickets made a 60 KB error
        const chain = await Promise.all(path.slice(0, 5).map((r) => describe(db, r)));
        const more = path.length > 5 ? ` and ${path.length - 5} more` : "";
        throw new ValidationError(`This would close a cycle with the existing relations ${chain.join(", ")}${more}`);
      }
    }

    // Insert the forward relation
    const rows = await db.all<Relation>(
      `INSERT INTO ticket_relations (project_id, source_id, target_id, relation_type)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
      projectId,
      normSource,
      normTarget,
      relationType
    );

    // For asymmetric relations, also insert the inverse, unless it is there
    if (!rt.symmetric && !(await findRelation(db, projectId, targetId, sourceId, rt.inverse))) {
      await db.run(
        `INSERT INTO ticket_relations (project_id, source_id, target_id, relation_type)
         VALUES (?, ?, ?, ?)`,
        projectId,
        targetId,
        sourceId,
        rt.inverse
      );
    }

    return rows[0];
  });
}

export async function removeRelation(
  db: DB,
  projectId: number,
  source: number,
  target: number,
  type: string
): Promise<boolean> {
  return db.transaction(async () => {
    const { sourceId, targetId, type: relationType } = canonicalRelation(source, target, type);
    const rt = getRelationType(relationType);
    const [normSource, normTarget] = storedPair(sourceId, targetId, rt);

    if (!(await findRelation(db, projectId, normSource, normTarget, relationType))) {
      throw new ValidationError("Relation not found");
    }

    const remove = (from: number, to: number, relType: string) =>
      db.run(
        `DELETE FROM ticket_relations
         WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId,
        from,
        to,
        relType
      );
    await remove(normSource, normTarget, relationType);
    // The inverse row of an asymmetric relation goes with it
    if (!rt.symmetric) await remove(targetId, sourceId, rt.inverse);

    return true;
  });
}

export async function listRelations(
  db: DB,
  projectId: number,
  ticketId: number
): Promise<RelationView[]> {
  // For asymmetric relations, both forward and inverse rows are stored,
  // so querying by source_id alone gives the complete picture from this
  // ticket's perspective. For symmetric relations (e.g. relates-to), only
  // one normalised row exists, so we also need to check target_id.
  const rows = await db.all<{
    id: number;
    source_id: number;
    target_id: number;
    relation_type: string;
  }>(
    `SELECT r.id, r.source_id, r.target_id, r.relation_type
     FROM ticket_relations r
     WHERE r.project_id = ? AND r.source_id = ?
     ORDER BY r.created_at`,
    projectId,
    ticketId
  );

  // For symmetric types, also pick up rows where this ticket is the target
  const symTypes = symmetricTypeNames();
  if (symTypes.length > 0) {
    const placeholders = symTypes.map(() => "?").join(", ");
    const symmetricRows = await db.all<{
      id: number;
      source_id: number;
      target_id: number;
      relation_type: string;
    }>(
      `SELECT r.id, r.source_id, r.target_id, r.relation_type
       FROM ticket_relations r
       WHERE r.project_id = ? AND r.target_id = ? AND r.source_id != ?
         AND r.relation_type IN (${placeholders})
       ORDER BY r.created_at`,
      projectId,
      ticketId,
      ticketId,
      ...symTypes
    );
    rows.push(...symmetricRows);
  }

  // Collect all related ticket IDs and fetch titles in one query
  const ticketIds = new Set<number>();
  for (const r of rows) {
    ticketIds.add(r.source_id === ticketId ? r.target_id : r.source_id);
  }

  const titleMap = new Map<number, string>();
  if (ticketIds.size > 0) {
    const placeholders = [...ticketIds].map(() => "?").join(", ");
    const titleRows = await db.all<{ id: number; title: string }>(
      `SELECT id, title FROM tickets WHERE id IN (${placeholders})`,
      ...ticketIds
    );
    for (const row of titleRows) titleMap.set(row.id, row.title);
  }

  // Every asymmetric relation is stored twice, each row with its ticket as
  // source: the forward name (blocks) marks the ticket that holds the
  // relation, the inverse name (is-blocked-by) the one it points at. Symmetric
  // rows are stored in id order, which says nothing about direction.
  const forward = new Set(forwardTypeNames());
  const symmetric = new Set(symTypes);
  // An inverse row is an internal mirror: report the id of the relation it
  // mirrors, the one relation_list_all shows
  const forwardOf = new Map(allRelationTypes().map((rt) => [rt.inverse, rt.forward]));
  const isInverse = (type: string) => !forward.has(type) && !symmetric.has(type);
  // The rows mirrored are the forward rows pointing at this ticket: all of
  // them in one query, by source and type, not one query per inverse row
  const mirrored = new Map<string, number>();
  if (rows.some((r) => isInverse(r.relation_type))) {
    const pointing = await db.all<{ id: number; source_id: number; relation_type: string }>(
      `SELECT id, source_id, relation_type FROM ticket_relations WHERE project_id = ? AND target_id = ?`,
      projectId,
      ticketId
    );
    for (const m of pointing) mirrored.set(`${m.source_id}:${m.relation_type}`, m.id);
  }
  const result: RelationView[] = [];
  for (const r of rows) {
    const otherId = r.source_id === ticketId ? r.target_id : r.source_id;
    const id = isInverse(r.relation_type) ? mirrored.get(`${r.target_id}:${forwardOf.get(r.relation_type)}`) ?? r.id : r.id;
    result.push({
      id,
      relation_type: r.relation_type,
      ticket_id: otherId,
      ticket_title: titleMap.get(otherId) ?? `#${otherId}`,
      direction: symmetric.has(r.relation_type) ? "both" : forward.has(r.relation_type) ? "outgoing" : "incoming",
    });
  }

  return result;
}

export interface ProjectRelationView {
  id: number;
  source_id: number;
  source_title: string;
  target_id: number;
  target_title: string;
  relation_type: string;
}

export async function listProjectRelations(
  db: DB,
  projectId: number
): Promise<ProjectRelationView[]> {
  // Forward rows only: the stored inverse rows of asymmetric relations
  // would otherwise list every such relation twice.
  const types = forwardTypeNames();
  return db.all<ProjectRelationView>(
    `SELECT r.id, r.source_id, s.title AS source_title,
            r.target_id, t.title AS target_title, r.relation_type
     FROM ticket_relations r
     JOIN tickets s ON s.id = r.source_id
     JOIN tickets t ON t.id = r.target_id
     WHERE r.project_id = ? AND r.relation_type IN (${types.map(() => "?").join(", ")})
     ORDER BY r.created_at, r.id`,
    projectId,
    ...types
  );
}
