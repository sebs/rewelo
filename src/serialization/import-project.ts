import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assignTag } from "../tags/assignment.js";
import type { TagPair } from "./export-project.js";

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
  projectTags?: TagPair[]
): Promise<{ imported: number; tagsCreated: number }> {
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

  return { imported: tickets.length, tagsCreated };
}
