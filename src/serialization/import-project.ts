import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assignTag } from "../tags/assignment.js";
import { createRelation } from "../relations/repository.js";
import { canonicalRelation, isSymmetric } from "../relations/types.js";
import { setWeights } from "../weights/repository.js";
import { getTicketByTitle } from "../tickets/repository.js";
import { ValidationError } from "../validation/strings.js";
import type { SerializedRelation, SerializedWeights, TagPair } from "./export-project.js";

export interface ImportableRevision {
  title: string;
  description: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: TagPair[];
  revised_at: string;
  /** Position in the original write order (event_order), if exported */
  sequence?: number;
}

export interface ImportableTagChange {
  action: "added" | "removed";
  /** The tag's name at the time of the change */
  prefix: string;
  value: string;
  /** The tag's name at export time; null if the tag was deleted since */
  tag?: TagPair | null;
  /** The tag's id in the exporting database: which changes are of one tag */
  tagId?: number;
  changed_at: string;
  /** Position in the original write order (event_order), if exported */
  sequence?: number;
}

/** History from `export json --with-history`, restored as it was */
export interface ImportableHistory {
  createdAt?: string;
  updatedAt?: string;
  revisions?: ImportableRevision[];
  tagChanges?: ImportableTagChange[];
}

export interface ImportableTicket {
  title: string;
  description?: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags?: TagPair[];
  history?: ImportableHistory;
}

export async function importProjectData(
  db: DB,
  projectId: number,
  tickets: ImportableTicket[],
  projectTags?: TagPair[],
  extras: { relations?: SerializedRelation[]; weights?: SerializedWeights } = {}
): Promise<{ imported: number; tagsCreated: number; relationsCreated: number; weights?: SerializedWeights }> {
  return db.transaction(async () => {
    let tagsCreated = 0;
    let relationsCreated = 0;

    // Pre-create any project-level tags
    if (projectTags) {
      for (const tagDef of projectTags) {
        const existing = await getTag(db, projectId, tagDef.prefix, tagDef.value);
        if (!existing) {
          await createTag(db, projectId, tagDef.prefix, tagDef.value);
          tagsCreated++;
        }
      }
    }

    // History rows of all tickets, written after the tickets in their original
    // order: the event log breaks timestamp ties by write order
    const history: PendingHistoryRow[] = [];
    const firstTicket = new Map<string, number>();
    for (const [i, t] of tickets.entries()) {
      // Titles are normalised by now, so "café" (NFC/NFD) or "a  b" repeat here
      const earlier = firstTicket.get(t.title);
      if (earlier !== undefined) {
        throw new ValidationError(`Ticket ${i + 1}: title "${t.title}" is the same as ticket ${earlier + 1}'s`);
      }
      firstTicket.set(t.title, i);
      let ticket;
      try {
        ticket = await createTicket(db, {
          projectId,
          title: t.title,
          description: t.description ?? undefined,
          benefit: t.benefit,
          penalty: t.penalty,
          estimate: t.estimate,
          risk: t.risk,
        });
      } catch (e) {
        // e.g. a title already taken, in the project or earlier in the file
        if (e instanceof ValidationError) throw new ValidationError(`Ticket ${i + 1}: ${e.message}`);
        throw e;
      }

      if (t.tags) {
        for (const tagDef of t.tags) {
          let tag = await getTag(db, projectId, tagDef.prefix, tagDef.value);
          if (!tag) {
            tag = await createTag(db, projectId, tagDef.prefix, tagDef.value);
            tagsCreated++;
          }
          await assignTag(db, ticket.id, tag.id);
        }
      }

      if (t.history) history.push(...(await prepareHistory(db, ticket.id, t.history)));
    }
    tagsCreated += await writeHistory(db, projectId, history);

    for (const [i, r] of (extras.relations ?? []).entries()) {
      const source = await getTicketByTitle(db, projectId, r.source);
      const target = await getTicketByTitle(db, projectId, r.target);
      if (!source || !target) {
        throw new ValidationError(`Relation ${i + 1}: ticket "${source ? r.target : r.source}" not found`);
      }
      const canonical = canonicalRelation(source.id, target.id, r.type);
      // Symmetric relations are stored with the lower ticket id first
      const [from, to] = isSymmetric(canonical.type) && canonical.sourceId > canonical.targetId
        ? [canonical.targetId, canonical.sourceId]
        : [canonical.sourceId, canonical.targetId];
      const exists = await db.all(
        `SELECT 1 FROM ticket_relations WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId, from, to, canonical.type
      );
      try {
        if (exists.length === 0) {
          await createRelation(db, projectId, source.id, target.id, r.type);
          relationsCreated++;
        }
      } catch (e) {
        // e.g. a self-relation, or one contradicting an earlier relation
        if (e instanceof ValidationError) throw new ValidationError(`Relation ${i + 1}: ${e.message}`);
        throw e;
      }
    }

    if (extras.weights) {
      const { w1, w2, w3, w4 } = extras.weights;
      await setWeights(db, projectId, w1, w2, w3, w4);
    }

    // Say what else changed: the file's weights replace the project's, and
    // neither that nor the relations showed in the result
    return {
      imported: tickets.length,
      tagsCreated,
      relationsCreated,
      ...(extras.weights ? { weights: extras.weights } : {}),
    };
  });
}

type PendingHistoryRow = { ticketId: number; sequence?: number; at: string } & (
  | { revision: ImportableRevision }
  | { tagChange: ImportableTagChange }
);

// Put back what `export json --with-history` recorded, so lead and cycle
// times and the event log survive a backup and restore. The creation time is
// set right away; revisions and tag changes are returned to be written later.
async function prepareHistory(db: DB, ticketId: number, history: ImportableHistory): Promise<PendingHistoryRow[]> {
  if (history.createdAt) {
    await db.run(`UPDATE tickets SET created_at = ? WHERE id = ?`, history.createdAt, ticketId);
  }
  // Else the ticket's last update would be the import
  const updated = history.updatedAt ?? history.createdAt;
  if (updated) await db.run(`UPDATE tickets SET updated_at = ? WHERE id = ?`, updated, ticketId);
  // Assigning the ticket's tags just now logged them with today's date. With
  // tag changes in the file those replace them; without, but with an older
  // createdAt, when the tags were added is unknown: keep no date rather than
  // today's (a ticket from 2020 tagged done showed a lead time of 2,459 days)
  if (history.tagChanges || history.createdAt) {
    await db.run(`DELETE FROM ticket_tag_changes WHERE ticket_id = ?`, ticketId);
  }
  return [
    ...(history.revisions ?? []).map((revision) => ({ ticketId, sequence: revision.sequence, at: revision.revised_at, revision })),
    ...(history.tagChanges ?? []).map((tagChange) => ({ ticketId, sequence: tagChange.sequence, at: tagChange.changed_at, tagChange })),
  ];
}

// A tag id no tag has: AUTOINCREMENT never hands out a deleted row's id again
async function deletedTagId(db: DB, projectId: number): Promise<number> {
  const [{ id }] = await db.all<{ id: number }>(
    `INSERT INTO tags (project_id, prefix, value) VALUES (?, 'deleted', ?) RETURNING id`,
    projectId,
    `import-${Date.now()}-${Math.random()}`
  );
  await db.run(`DELETE FROM tags WHERE id = ?`, id);
  return id;
}

// Write history rows in their original write order; rows without a sequence
// (older files) come after, by timestamp and then position in the file.
// Returns the number of tags created for tag changes whose tag no longer
// existed.
async function writeHistory(db: DB, projectId: number, rows: PendingHistoryRow[]): Promise<number> {
  let tagsCreated = 0;
  // Tags deleted in the exporting project: their changes keep an id of their
  // own that no tag has, as they did there (creating the tag brought it back)
  const deleted = new Map<string, number>();
  const key = (row: PendingHistoryRow) => row.sequence ?? Infinity;
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      key(a.row) !== key(b.row) ? (key(a.row) < key(b.row) ? -1 : 1)
      : a.row.at !== b.row.at ? (a.row.at < b.row.at ? -1 : 1)
      : a.index - b.index)
    .map(({ row }) => row);
  for (const row of sorted) {
    if ("revision" in row) {
      const r = row.revision;
      await db.run(
        `INSERT INTO ticket_revisions (ticket_id, title, description, benefit, penalty, estimate, risk, tags, revised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.ticketId, r.title, r.description, r.benefit, r.penalty, r.estimate, r.risk, JSON.stringify(r.tags), r.revised_at
      );
      continue;
    }
    const c = row.tagChange;
    if (c.tag === null) {
      const key = c.tagId !== undefined ? `#${c.tagId}` : `${c.prefix}:${c.value}`;
      let id = deleted.get(key);
      if (id === undefined) id = await deletedTagId(db, projectId);
      deleted.set(key, id);
      await db.run(
        `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        row.ticketId, id, c.prefix, c.value, c.action, c.changed_at
      );
      continue;
    }
    // Link the change to the tag as it is named now, so lead and cycle
    // times (which follow the tag, not its old name) come out the same
    const { prefix, value } = c.tag ?? c;
    let tag = await getTag(db, projectId, prefix, value);
    if (!tag) {
      tag = await createTag(db, projectId, prefix, value);
      tagsCreated++;
    }
    await db.run(
      `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      row.ticketId, tag.id, c.prefix, c.value, c.action, c.changed_at
    );
  }
  return tagsCreated;
}
