import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
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
  const tickets = await listTickets(db, projectId);
  const allTags = await listTags(db, projectId);

  // Batch fetch all tag assignments for this project's tickets in one query
  const tagRows = await db.all<{ ticket_id: number; prefix: string; value: string }>(
    `SELECT tt.ticket_id, tg.prefix, tg.value
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
    arr.push({ prefix: row.prefix, value: row.value });
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
