import { DB } from "../db/connection.js";
import { ensureTag } from "../tags/repository.js";
import { assertOneValuePerPrefix, assignTag } from "../tags/assignment.js";
import type { TagFilter as TagPair } from "../tickets/repository.js";
import { validateTagPrefix, validateTagValue } from "../validation/strings.js";
import { requireTicket } from "./tickets.js";

export interface AssignRow {
  ticket: string;
  tag: string;
  status: "assigned" | "already_assigned";
  /** Same-prefix tags this assignment replaced, as "prefix:value" */
  replaced?: string[];
  /** The tag did not exist and was created (on the first ticket's row only) */
  tagCreated?: true;
}

/**
 * Tags to assign, validated as they are stored. The same tag named twice
 * (possibly spelt differently) counts once; two values of one prefix are an
 * error, as a ticket holds one value per prefix.
 */
export function prepareTags(tags: TagPair[]): TagPair[] {
  const unique = new Map<string, TagPair>();
  for (const t of tags) {
    const tag = { prefix: validateTagPrefix(t.prefix), value: validateTagValue(t.value) };
    const label = `${tag.prefix}:${tag.value}`;
    if (!unique.has(label)) unique.set(label, tag);
  }
  const prepared = [...unique.values()];
  assertOneValuePerPrefix(prepared);
  return prepared;
}

/**
 * Assign tags (from prepareTags) to tickets, creating tags that don't exist
 * yet. Every ticket is looked up before anything is written, and the rest
 * runs in one transaction: a missing ticket aborts the whole batch instead of
 * half of it, and leaves no new tags behind.
 */
export async function assignTags(db: DB, projectId: number, ticketTitles: string[], tags: TagPair[]): Promise<AssignRow[]> {
  const tickets: { title: string; id: number }[] = [];
  for (const title of new Set(ticketTitles)) {
    const ticket = await requireTicket(db, projectId, title);
    // Two spellings of one title are one ticket
    if (!tickets.some((t) => t.id === ticket.id)) tickets.push({ title: ticket.title, id: ticket.id });
  }

  return db.transaction(async () => {
    const resolved: { label: string; id: number; created: boolean }[] = [];
    for (const t of tags) {
      const { tag, created } = await ensureTag(db, projectId, t.prefix, t.value);
      resolved.push({ label: `${t.prefix}:${t.value}`, id: tag.id, created });
    }
    const rows: AssignRow[] = [];
    for (const ticket of tickets) {
      for (const tag of resolved) {
        const { assigned, replaced } = await assignTag(db, ticket.id, tag.id);
        rows.push({
          ticket: ticket.title,
          tag: tag.label,
          status: assigned ? "assigned" : "already_assigned",
          ...(replaced.length > 0 ? { replaced } : {}),
          ...(tag.created && ticket === tickets[0] ? { tagCreated: true as const } : {}),
        });
      }
    }
    return rows;
  });
}
