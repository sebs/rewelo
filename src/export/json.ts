import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { listRevisions } from "../revisions/repository.js";
import { getTagChangeLog } from "../tags/audit.js";
import { listTags } from "../tags/repository.js";
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
  // One snapshot: a ticket deleted or imported between the queries below
  // made the export fail, or pair tickets with other tickets' history
  return db.readTransaction(() => readProject(db, projectId, options));
}

async function readProject(db: DB, projectId: number, options: JsonExportOptions): Promise<ExportedProject> {
  const data = await exportProjectData(db, projectId);

  if (!options.withHistory) {
    return data;
  }

  // Enrich tickets with revision history
  const tickets = await listTickets(db, projectId);
  // A tag change records the tag's name at the time; `tag` names the tag it
  // is now, so a restore links the change to the same tag after a rename,
  // and is null for a tag deleted since (a restore must not bring it back).
  // tag_id tells which changes belong to one tag, across renames.
  const currentTags = new Map((await listTags(db, projectId)).map((t) => [t.id, { prefix: t.prefix, value: t.value }]));
  // The order history rows were written in, so an import can restore
  // same-millisecond events in the same order
  const sequences = new Map(
    (await db.all<{ source: string; row_id: number; seq: number }>(
      `SELECT source, row_id, seq FROM event_order WHERE source IN ('revision', 'tag_change')`
    )).map((r) => [`${r.source}:${r.row_id}`, r.seq])
  );
  const enrichedTickets: ExportedTicket[] = [];

  // Titles are unique in a project: pair by title, not by position
  const byTitle = new Map(tickets.map((t) => [t.title, t]));
  for (const serialized of data.tickets) {
    const ticket = byTitle.get(serialized.title)!;
    const exported: ExportedTicket = { ...serialized, createdAt: ticket.created_at };
    exported.revisions = (await listRevisions(db, ticket.id)).map((r) => ({ ...r, sequence: sequences.get(`revision:${r.id}`) }));
    exported.tagChanges = (await getTagChangeLog(db, ticket.id)).map((c) => ({
      ...c,
      tag: currentTags.get(c.tag_id) ?? null,
      sequence: sequences.get(`tag_change:${c.id}`),
    }));
    enrichedTickets.push(exported);
  }

  return { ...data, tickets: enrichedTickets };
}
