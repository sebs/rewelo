import { DB } from "../db/connection.js";
import { listRevisions } from "../revisions/repository.js";
import { getTagChangeLog } from "../tags/audit.js";
import { listTags } from "../tags/repository.js";
import {
  exportProjectData,
  SerializedTicket,
  SerializedProject,
} from "../serialization/export-project.js";
import { jsonChunks } from "./json-stream.js";

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
};

/**
 * Write the export as indented JSON, building each ticket's history only
 * when it is written: the histories of 100,000 tickets at once ran the
 * 192 MB heap out of memory. Reads one snapshot, as exportJson does.
 */
export async function writeJsonExport(
  db: DB,
  projectId: number,
  options: JsonExportOptions & { indent?: boolean },
  write: (chunks: AsyncIterable<string>) => Promise<void>
): Promise<void> {
  await db.readTransaction(async () => {
    const { data, tickets } = await readProject(db, projectId, options);
    await write(jsonChunks({ ...data, tickets }, { indent: options.indent ?? true }));
  });
}

async function readProject(
  db: DB,
  projectId: number,
  options: JsonExportOptions
): Promise<{ data: SerializedProject; tickets: AsyncIterable<ExportedTicket> }> {
  const data = await exportProjectData(db, projectId);
  if (!options.withHistory) return { data, tickets: fromArray(data.tickets) };

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
        revisions: (await listRevisions(db, ticket.id)).map((r) => ({ ...r, sequence: sequences.get(`revision:${r.id}`) })),
        tagChanges: (await getTagChangeLog(db, ticket.id)).map((c) => ({
          ...c,
          tag: currentTags.get(c.tag_id) ?? null,
          sequence: sequences.get(`tag_change:${c.id}`),
        })),
      };
    }
  }
  return { data, tickets: withHistory() };
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  yield* items;
}
