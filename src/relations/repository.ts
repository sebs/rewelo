import { DB } from "../db/connection.js";
import { ValidationError } from "../errors.js";
import { allRelationTypes, canonicalRelation, forwardTypeNames, getRelationType, getInverse, isSymmetric, symmetricTypeNames } from "./types.js";

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

// "C" blocks "A", by titles: "the target blocks the source" read backwards
// when the new relation was given by its inverse name (is-blocked-by)
async function describe(db: DB, relation: Relation): Promise<string> {
  const title = async (id: number) =>
    (await db.all<{ title: string }>(`SELECT title FROM tickets WHERE id = ?`, id))[0]?.title;
  return `"${await title(relation.source_id)}" ${relation.relation_type} "${await title(relation.target_id)}"`;
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

    // For symmetric relations, normalise order so (A,B) and (B,A) are the same
    let normSource = sourceId;
    let normTarget = targetId;
    if (rt.symmetric && sourceId > targetId) {
      normSource = targetId;
      normTarget = sourceId;
    }

    // Check for duplicate
    const existing = await db.all<Relation>(
      `SELECT * FROM ticket_relations
       WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
      projectId,
      normSource,
      normTarget,
      relationType
    );
    if (existing.length > 0) {
      throw new ValidationError("Relation already exists");
    }

    // An asymmetric relation in both directions contradicts itself
    // (A blocks B and B blocks A)
    if (!rt.symmetric) {
      const reverse = await db.all<Relation>(
        `SELECT * FROM ticket_relations
         WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId,
        targetId,
        sourceId,
        relationType
      );
      if (reverse.length > 0) {
        throw new ValidationError(`The reverse relation already exists: ${await describe(db, reverse[0])}`);
      }
    }

    // Relations that order two tickets must agree across types: A blocks B
    // and A depends-on B say opposite things
    const first = firstOf({ source_id: sourceId, target_id: targetId, relation_type: relationType });
    if (first !== undefined) {
      const ordering = await db.all<Relation>(
        `SELECT * FROM ticket_relations
         WHERE project_id = ? AND relation_type IN (${Object.keys(ORDER).map(() => "?").join(", ")})
           AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))`,
        projectId,
        ...Object.keys(ORDER),
        sourceId,
        targetId,
        targetId,
        sourceId
      );
      const opposite = ordering.find((r) => firstOf(r) !== first);
      if (opposite) {
        throw new ValidationError(`This contradicts an existing relation: ${await describe(db, opposite)}`);
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

    // For asymmetric relations, also insert the inverse
    if (!rt.symmetric) {
      const inverseType = getInverse(relationType);

      // Check inverse doesn't already exist
      const existingInverse = await db.all<Relation>(
        `SELECT * FROM ticket_relations
         WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId,
        targetId,
        sourceId,
        inverseType
      );
      if (existingInverse.length === 0) {
        await db.run(
          `INSERT INTO ticket_relations (project_id, source_id, target_id, relation_type)
           VALUES (?, ?, ?, ?)`,
          projectId,
          targetId,
          sourceId,
          inverseType
        );
      }
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

    // For symmetric relations, normalise order
    let normSource = sourceId;
    let normTarget = targetId;
    if (rt.symmetric && sourceId > targetId) {
      normSource = targetId;
      normTarget = sourceId;
    }

    // Check if the relation exists
    const existing = await db.all<Relation>(
      `SELECT * FROM ticket_relations
       WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
      projectId,
      normSource,
      normTarget,
      relationType
    );
    if (existing.length === 0) {
      throw new ValidationError("Relation not found");
    }

    // Delete forward
    await db.run(
      `DELETE FROM ticket_relations
       WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
      projectId,
      normSource,
      normTarget,
      relationType
    );

    // Delete inverse for asymmetric
    if (!rt.symmetric) {
      const inverseType = getInverse(relationType);
      await db.run(
        `DELETE FROM ticket_relations
         WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId,
        targetId,
        sourceId,
        inverseType
      );
    }

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
  const result: RelationView[] = [];
  for (const r of rows) {
    const otherId = r.source_id === ticketId ? r.target_id : r.source_id;
    let id = r.id;
    if (!forward.has(r.relation_type) && !symmetric.has(r.relation_type)) {
      const [mirrored] = await db.all<{ id: number }>(
        `SELECT id FROM ticket_relations WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId, r.target_id, r.source_id, forwardOf.get(r.relation_type)
      );
      if (mirrored) id = mirrored.id;
    }
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

export async function deleteRelationsForTicket(
  db: DB,
  ticketId: number
): Promise<void> {
  await db.run(
    `DELETE FROM ticket_relations WHERE source_id = ? OR target_id = ?`,
    ticketId,
    ticketId
  );
}

export async function deleteRelationsForProject(
  db: DB,
  projectId: number
): Promise<void> {
  await db.run(
    `DELETE FROM ticket_relations WHERE project_id = ?`,
    projectId
  );
}
