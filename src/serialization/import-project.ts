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

export interface ImportableTicket {
  title: string;
  description?: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags?: TagPair[];
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

    for (const t of tickets) {
      const ticket = await createTicket(db, {
        projectId,
        title: t.title,
        description: t.description ?? undefined,
        benefit: t.benefit,
        penalty: t.penalty,
        estimate: t.estimate,
        risk: t.risk,
      });

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
