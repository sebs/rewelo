import { DB } from "../db/connection.js";
import { listTags } from "../tags/repository.js";
import { listProjectRelations } from "../relations/repository.js";
import { getWeights } from "../weights/repository.js";

export interface TagPair {
  prefix: string;
  value: string;
}

export interface SerializedTicket {
  title: string;
  description: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: TagPair[];
}

export interface SerializedRelation {
  source: string;
  type: string;
  target: string;
}

export interface SerializedWeights {
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

export interface SerializedProject {
  tickets: SerializedTicket[];
  tags: TagPair[];
  /** Between tickets, by title */
  relations: SerializedRelation[];
  weights: SerializedWeights;
}

export async function exportProjectData(
  db: DB,
  projectId: number
): Promise<SerializedProject> {
  // Only the columns written, in listTickets' order: whole rows of 100,000
  // tickets (with ids, UUIDs and timestamps) ran the 192 MB heap out of memory
  const tickets = await db.all<Omit<SerializedTicket, "tags"> & { id: number }>(
    `SELECT id, title, description, benefit, penalty, estimate, risk
     FROM tickets WHERE project_id = ? ORDER BY created_at`,
    projectId
  );
  const allTags = await listTags(db, projectId);

  // Batch fetch all tag assignments for this project's tickets in one query,
  // sharing one object per tag (not one per assignment: 200,000 of them)
  const pairs = new Map(allTags.map((t) => [t.id, { prefix: t.prefix, value: t.value }]));
  const tagRows = await db.all<{ ticket_id: number; tag_id: number }>(
    `SELECT tt.ticket_id, tt.tag_id
     FROM ticket_tags tt
     JOIN tags tg ON tg.id = tt.tag_id
     JOIN tickets tk ON tk.id = tt.ticket_id
     WHERE tk.project_id = ?
     ORDER BY tt.ticket_id, tg.prefix, tg.value`,
    projectId
  );

  const tagsByTicket = new Map<number, TagPair[]>();
  for (const row of tagRows) {
    let arr = tagsByTicket.get(row.ticket_id);
    if (!arr) { arr = []; tagsByTicket.set(row.ticket_id, arr); }
    arr.push(pairs.get(row.tag_id)!);
  }

  const serializedTickets: SerializedTicket[] = tickets.map((ticket) => ({
    title: ticket.title,
    description: ticket.description,
    benefit: ticket.benefit,
    penalty: ticket.penalty,
    estimate: ticket.estimate,
    risk: ticket.risk,
    tags: tagsByTicket.get(ticket.id) ?? [],
  }));

  const relations = await listProjectRelations(db, projectId);
  const { w1, w2, w3, w4 } = await getWeights(db, projectId);

  return {
    tickets: serializedTickets,
    tags: allTags.map((t) => ({ prefix: t.prefix, value: t.value })),
    relations: relations.map((r) => ({ source: r.source_title, type: r.relation_type, target: r.target_title })),
    weights: { w1, w2, w3, w4 },
  };
}
