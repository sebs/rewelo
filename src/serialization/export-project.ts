import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { listTags } from "../tags/repository.js";
import { getTicketTags } from "../tags/assignment.js";

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

export interface SerializedProject {
  tickets: SerializedTicket[];
  tags: TagPair[];
}

export async function exportProjectData(
  db: DB,
  projectId: number
): Promise<SerializedProject> {
  const tickets = await listTickets(db, projectId);
  const allTags = await listTags(db, projectId);

  const serializedTickets: SerializedTicket[] = [];

  for (const ticket of tickets) {
    const ticketTags = await getTicketTags(db, ticket.id);
    serializedTickets.push({
      title: ticket.title,
      description: ticket.description,
      benefit: ticket.benefit,
      penalty: ticket.penalty,
      estimate: ticket.estimate,
      risk: ticket.risk,
      tags: ticketTags.map((t) => ({ prefix: t.prefix, value: t.value })),
    });
  }

  return {
    tickets: serializedTickets,
    tags: allTags.map((t) => ({ prefix: t.prefix, value: t.value })),
  };
}
