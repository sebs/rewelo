import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { listRevisions } from "../revisions/repository.js";
import { getTagChangeLog } from "../tags/audit.js";
import {
  exportProjectData,
  SerializedTicket,
  SerializedProject,
} from "../serialization/export-project.js";

export interface JsonExportOptions {
  withHistory?: boolean;
}

export interface ExportedTicket extends SerializedTicket {
  createdAt?: string;
  revisions?: unknown[];
  tagChanges?: unknown[];
}

export type ExportedProject = SerializedProject & {
  tickets: ExportedTicket[];
};

export async function exportJson(
  db: DB,
  projectId: number,
  options: JsonExportOptions = {}
): Promise<ExportedProject> {
  const data = await exportProjectData(db, projectId);

  if (!options.withHistory) {
    return data;
  }

  // Enrich tickets with revision history
  const tickets = await listTickets(db, projectId);
  const enrichedTickets: ExportedTicket[] = [];

  for (let i = 0; i < data.tickets.length; i++) {
    const exported: ExportedTicket = { ...data.tickets[i], createdAt: tickets[i].created_at };
    exported.revisions = await listRevisions(db, tickets[i].id);
    exported.tagChanges = await getTagChangeLog(db, tickets[i].id);
    enrichedTickets.push(exported);
  }

  return { ...data, tickets: enrichedTickets };
}
