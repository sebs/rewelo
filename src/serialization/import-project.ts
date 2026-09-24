import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assignTag } from "../tags/assignment.js";
import { createRelation } from "../relations/repository.js";
import { canonicalRelation } from "../relations/types.js";
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
}

export interface ImportableTagChange {
  action: "added" | "removed";
  prefix: string;
  value: string;
  changed_at: string;
}

/** History from `export json --with-history`, restored as it was */
export interface ImportableHistory {
  createdAt?: string;
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
): Promise<{ imported: number; tagsCreated: number }> {
  return db.transaction(async () => {
    let tagsCreated = 0;

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

    for (const [i, t] of tickets.entries()) {
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

      if (t.history) tagsCreated += await restoreHistory(db, projectId, ticket.id, t.history);
    }

    for (const [i, r] of (extras.relations ?? []).entries()) {
      const source = await getTicketByTitle(db, projectId, r.source);
      const target = await getTicketByTitle(db, projectId, r.target);
      if (!source || !target) {
        throw new ValidationError(`Relation ${i + 1}: ticket "${source ? r.target : r.source}" not found`);
      }
      const canonical = canonicalRelation(source.id, target.id, r.type);
      const exists = await db.all(
        `SELECT 1 FROM ticket_relations WHERE project_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?`,
        projectId, canonical.sourceId, canonical.targetId, canonical.type
      );
      if (exists.length === 0) await createRelation(db, projectId, source.id, target.id, r.type);
    }

    if (extras.weights) {
      const { w1, w2, w3, w4 } = extras.weights;
      await setWeights(db, projectId, w1, w2, w3, w4);
    }

    return { imported: tickets.length, tagsCreated };
  });
}

// Put back what `export json --with-history` recorded, so lead and cycle
// times and the event log survive a backup and restore. Returns the number
// of tags created for tag changes whose tag no longer existed.
async function restoreHistory(db: DB, projectId: number, ticketId: number, history: ImportableHistory): Promise<number> {
  let tagsCreated = 0;
  if (history.createdAt) {
    await db.run(`UPDATE tickets SET created_at = ? WHERE id = ?`, history.createdAt, ticketId);
  }
  for (const r of history.revisions ?? []) {
    await db.run(
      `INSERT INTO ticket_revisions (ticket_id, title, description, benefit, penalty, estimate, risk, tags, revised_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ticketId, r.title, r.description, r.benefit, r.penalty, r.estimate, r.risk, JSON.stringify(r.tags), r.revised_at
    );
  }
  if (history.tagChanges) {
    // Replace the changes logged just now by assigning the current tags
    await db.run(`DELETE FROM ticket_tag_changes WHERE ticket_id = ?`, ticketId);
    for (const c of history.tagChanges) {
      let tag = await getTag(db, projectId, c.prefix, c.value);
      if (!tag) {
        tag = await createTag(db, projectId, c.prefix, c.value);
        tagsCreated++;
      }
      await db.run(
        `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ticketId, tag.id, c.prefix, c.value, c.action, c.changed_at
      );
    }
  }
  return tagsCreated;
}
