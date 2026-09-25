import { DB } from "../../db/connection.js";
import { listProjectRelations } from "../../relations/repository.js";
import { listRevisions } from "../../revisions/repository.js";
import { getTagChangeLog } from "../../tags/audit.js";
import { listTags } from "../../tags/repository.js";
import { jsonChunks, type JsonLayout } from "./stream.js";
import type { SerializedProject, SerializedTicket, TagPair, SerializedDeletion } from "../types.js";
import { getWeights } from "../../weights/repository.js";

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

export interface JsonExportOptions {
  withHistory?: boolean;
}

export interface ExportedTicket extends SerializedTicket {
  createdAt?: string;
  updatedAt?: string;
  revisions?: unknown[];
  tagChanges?: unknown[];
}

export type ExportedProject = SerializedProject & {
  tickets: ExportedTicket[];
  /** With history: the project's deleted tickets */
  deletions?: SerializedDeletion[];
};

/**
 * Write the export as indented JSON, building each ticket's history only
 * when it is written: the histories of 100,000 tickets at once ran the
 * 192 MB heap out of memory. Reads one snapshot, as exportJson does.
 * With history, each ticket is written on one line: indented, the history
 * of 50,000 tickets took a backup past the size an import accepts.
 */
export async function writeJsonExport(
  db: DB,
  projectId: number,
  options: JsonExportOptions & { indent?: JsonLayout },
  write: (chunks: AsyncIterable<string>) => Promise<void>
): Promise<void> {
  await db.readTransaction(async () => {
    const { data, tickets } = await readProject(db, projectId, options);
    await write(jsonChunks({ ...data, tickets }, { indent: options.indent ?? (options.withHistory ? "lines" : true) }));
  });
}

async function readProject(
  db: DB,
  projectId: number,
  options: JsonExportOptions
): Promise<{ data: SerializedProject & { deletions?: SerializedDeletion[] }; tickets: AsyncIterable<ExportedTicket> }> {
  const exported = await exportProjectData(db, projectId);
  if (!options.withHistory) return { data: exported, tickets: fromArray(exported.tickets) };

  // A deleted ticket's history goes with it; the deletion itself is all the
  // event log and project diff know of it
  const deletions = (await db.all<{ title: string; created_at: string | null; deleted_at: string; seq: number | null }>(
    `SELECT d.title, d.created_at, d.deleted_at, eo.seq FROM ticket_deletions d
     LEFT JOIN event_order eo ON eo.source = 'deletion' AND eo.row_id = d.id
     WHERE d.project_id = ? ORDER BY d.id`,
    projectId
  )).map((d) => ({ title: d.title, createdAt: d.created_at, deletedAt: d.deleted_at, ...(d.seq !== null ? { sequence: d.seq } : {}) }));
  const data = { ...exported, deletions };

  // Only what pairs tickets with their history: all tickets again,
  // descriptions and all, ran the 192 MB heap out of memory
  const rows = await db.all<{ id: number; title: string; created_at: string; updated_at: string }>(
    `SELECT id, title, created_at, updated_at FROM tickets WHERE project_id = ?`,
    projectId
  );
  // Titles are unique in a project: pair by title, not by position
  const byTitle = new Map(rows.map((t) => [t.title, t]));
  // A tag change records the tag's name at the time; `tag` names the tag it
  // is now, so a restore links the change to the same tag after a rename,
  // and is null for a tag deleted since (a restore must not bring it back).
  // tag_id tells which changes belong to one tag, across renames.
  const currentTags = new Map((await listTags(db, projectId)).map((t) => [t.id, { prefix: t.prefix, value: t.value }]));

  async function* withHistory(): AsyncGenerator<ExportedTicket> {
    for (const serialized of data.tickets) {
      const ticket = byTitle.get(serialized.title)!;
      // The order history rows were written in, so an import can restore
      // same-millisecond events in the same order
      const sequences = new Map(
        (await db.all<{ source: string; row_id: number; seq: number }>(
          `SELECT source, row_id, seq FROM event_order
           WHERE (source = 'revision' AND row_id IN (SELECT id FROM ticket_revisions WHERE ticket_id = ?))
              OR (source = 'tag_change' AND row_id IN (SELECT id FROM ticket_tag_changes WHERE ticket_id = ?))`,
          ticket.id,
          ticket.id
        )).map((r) => [`${r.source}:${r.row_id}`, r.seq])
      );
      yield {
        ...serialized,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        // Without the rows' own ids, which an import doesn't use; tag_id
        // tells which changes belong to one tag
        revisions: (await listRevisions(db, ticket.id)).map(({ id, ticket_id: _, ...r }) => ({ ...r, sequence: sequences.get(`revision:${id}`) })),
        tagChanges: (await getTagChangeLog(db, ticket.id)).map(({ id, ticket_id: _, ...c }) => ({
          ...c,
          tag: currentTags.get(c.tag_id) ?? null,
          sequence: sequences.get(`tag_change:${id}`),
        })),
      };
    }
  }
  return { data, tickets: withHistory() };
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}
