import { DB } from "../db/connection.js";
import { ValidationError } from "../validation/strings.js";
import { getRelationType, getInverse, isSymmetric, symmetricTypeNames } from "./types.js";

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
  direction: "outgoing" | "incoming";
}

export async function createRelation(
  db: DB,
  projectId: number,
  sourceId: number,
  targetId: number,
  relationType: string
): Promise<Relation> {
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
    `SELECT * FROM rw.ticket_relations
     WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
    projectId,
    normSource,
    normTarget,
    relationType
  );
  if (existing.length > 0) {
    throw new ValidationError("Relation already exists");
  }

  // Insert the forward relation
  const rows = await db.all<Relation>(
    `INSERT INTO rw.ticket_relations (project_id, source_id, target_id, relation_type)
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
      `SELECT * FROM rw.ticket_relations
       WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
      projectId,
      targetId,
      sourceId,
      inverseType
    );
    if (existingInverse.length === 0) {
      await db.run(
        `INSERT INTO rw.ticket_relations (project_id, source_id, target_id, relation_type)
         VALUES (?, ?, ?, ?)`,
        projectId,
        targetId,
        sourceId,
        inverseType
      );
    }
  }

  return rows[0];
}

export async function removeRelation(
  db: DB,
  projectId: number,
  sourceId: number,
  targetId: number,
  relationType: string
): Promise<boolean> {
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
    `SELECT * FROM rw.ticket_relations
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
    `DELETE FROM rw.ticket_relations
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
      `DELETE FROM rw.ticket_relations
       WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
      projectId,
      targetId,
      sourceId,
      inverseType
    );
  }

  return true;
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
     FROM rw.ticket_relations r
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
       FROM rw.ticket_relations r
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

  // Collect all related ticket IDs
  const ticketIds = new Set<number>();
  for (const r of rows) {
    ticketIds.add(r.source_id === ticketId ? r.target_id : r.source_id);
  }

  // Fetch titles
  const titleMap = new Map<number, string>();
  for (const id of ticketIds) {
    const tickets = await db.all<{ id: number; title: string }>(
      `SELECT id, title FROM rw.tickets WHERE id = ?`,
      id
    );
    if (tickets.length > 0) titleMap.set(id, tickets[0].title);
  }

  const result: RelationView[] = [];
  for (const r of rows) {
    const isSource = r.source_id === ticketId;
    const otherId = isSource ? r.target_id : r.source_id;
    result.push({
      id: r.id,
      relation_type: r.relation_type,
      ticket_id: otherId,
      ticket_title: titleMap.get(otherId) ?? `#${otherId}`,
      direction: isSource ? "outgoing" : "incoming",
    });
  }

  return result;
}

export async function deleteRelationsForTicket(
  db: DB,
  ticketId: number
): Promise<void> {
  await db.run(
    `DELETE FROM rw.ticket_relations WHERE source_id = ? OR target_id = ?`,
    ticketId,
    ticketId
  );
}

export async function deleteRelationsForProject(
  db: DB,
  projectId: number
): Promise<void> {
  await db.run(
    `DELETE FROM rw.ticket_relations WHERE project_id = ?`,
    projectId
  );
}
