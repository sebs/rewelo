import { DB } from "../../db/connection.js";
import { assertFibonacci } from "../../domain/scores.js";
import { ValidationError } from "../../errors.js";
import { ensureTag } from "../../tags/repository.js";
import { isBlank } from "../../text.js";
import { checkKeys, parseTags } from "./values.js";

// The keys export json --with-history writes (every version): the rows of
// ticket_revisions and ticket_tag_changes, with sequence and the tag's name now
const REVISION_KEYS = ["id", "ticket_id", "title", "description", "benefit", "penalty", "estimate", "risk", "tags", "revised_at", "sequence"];
const TAG_CHANGE_KEYS = ["id", "ticket_id", "tag_id", "action", "prefix", "value", "changed_at", "tag", "sequence"];
import type { ImportableHistory, ImportableRevision, ImportableTagChange, TagPair, SerializedDeletion } from "../types.js";
import { hasUnpairedSurrogate, validateTicketDescription } from "../../validation/strings.js";
import { normalizeSince } from "../../validation/timestamps.js";

// A ticket's history in the JSON export (--with-history): read, checked, and
// written back on import

function timestamp(raw: unknown, field: string): string {
  if (typeof raw !== "string") throw new ValidationError(`${field} must be an ISO timestamp`);
  try {
    return normalizeSince(raw);
  } catch {
    throw new ValidationError(`${field} must be an ISO timestamp`);
  }
}

export function sequence(raw: unknown, at: string): { sequence?: number } {
  if (raw === undefined || raw === null) return {};
  if (!Number.isSafeInteger(raw) || (raw as number) < 0) throw new ValidationError(`${at}: sequence must be a whole number`);
  return { sequence: raw as number };
}

function list(raw: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.some((e) => !e || typeof e !== "object")) {
    throw new ValidationError(`${field} must be an array of objects`);
  }
  return raw as Record<string, unknown>[];
}

// The createdAt, revisions and tagChanges written by `export json --with-history`
export function parseHistory(t: Record<string, unknown>): ImportableHistory | undefined {
  if (t.createdAt === undefined && t.updatedAt === undefined && t.revisions === undefined && t.tagChanges === undefined) return undefined;
  const history: ImportableHistory = {};
  if (t.createdAt !== undefined) history.createdAt = timestamp(t.createdAt, "createdAt");
  if (t.updatedAt !== undefined) history.updatedAt = timestamp(t.updatedAt, "updatedAt");
  if (t.revisions !== undefined) {
    history.revisions = list(t.revisions, "revisions").map((r, j) => {
      const at = `revision ${j + 1}`;
      checkKeys(r, REVISION_KEYS, at);
      const score = (name: string) => {
        // As for the ticket's own scores: no coercion from strings
        if (typeof r[name] !== "number") throw new ValidationError(`${at} ${name} must be a number, got ${JSON.stringify(r[name])}`);
        assertFibonacci(r[name] as number, `${at} ${name}`);
        return r[name] as number;
      };
      if (typeof r.title !== "string") throw new ValidationError(`${at}: title is required`);
      if (r.description !== null && r.description !== undefined && typeof r.description !== "string") {
        throw new ValidationError(`${at}: description must be a string`);
      }
      // A revision records a title as it was: titles allowed by the rules of
      // the time (e.g. with characters rejected today) must restore as well
      if (r.title.length === 0 || r.title.includes("\0") || hasUnpairedSurrogate(r.title) || r.title.length > 10_000) {
        throw new ValidationError(`${at}: title must be a non-empty string without null bytes or unpaired surrogates`);
      }
      return {
        title: r.title,
        // Blank is no description, as for tickets: "   " then null showed as a change
        description: typeof r.description === "string" && !isBlank(r.description) ? validateTicketDescription(r.description)! : null,
        benefit: score("benefit"),
        penalty: score("penalty"),
        estimate: score("estimate"),
        risk: score("risk"),
        tags: parseTags(r.tags, `${at}: tag`) ?? [],
        revised_at: timestamp(r.revised_at, `${at} revised_at`),
        ...sequence(r.sequence, at),
      };
    });
  }
  if (t.tagChanges !== undefined) {
    history.tagChanges = list(t.tagChanges, "tagChanges").map((c, j) => {
      const at = `tag change ${j + 1}`;
      checkKeys(c, TAG_CHANGE_KEYS, at);
      if (c.action !== "added" && c.action !== "removed") {
        throw new ValidationError(`${at}: action must be "added" or "removed"`);
      }
      const [historic] = parseTags([{ prefix: c.prefix, value: c.value }], `${at}: tag`)!;
      // null: the tag was deleted after the change
      const current = c.tag === undefined || c.tag === null ? c.tag : parseTags([c.tag], `${at}: current tag`)![0];
      if (c.tag_id !== undefined && (!Number.isSafeInteger(c.tag_id) || (c.tag_id as number) < 1)) {
        throw new ValidationError(`${at}: tag_id must be a positive whole number`);
      }
      return {
        action: c.action,
        ...historic,
        ...(current !== undefined ? { tag: current } : {}),
        ...(c.tag_id !== undefined ? { tagId: c.tag_id as number } : {}),
        changed_at: timestamp(c.changed_at, `${at} changed_at`),
        ...sequence(c.sequence, at),
      };
    });
  }
  // Without createdAt the ticket would count as created at import time, after
  // its own history (negative lead times): it existed by its first change
  if (history.createdAt === undefined) {
    const times = [...(history.revisions ?? []).map((r) => r.revised_at), ...(history.tagChanges ?? []).map((c) => c.changed_at)];
    if (times.length > 0) history.createdAt = times.reduce((a, b) => (a < b ? a : b));
  }
  return history;
}

// Imported history has to be one that could have happened: otherwise lead
// and cycle times come out negative or nonsensical.
// Clocks of the exporting and importing machines differ a little: a fresh
// backup restored on a machine a few seconds behind must still import
const CLOCK_SKEW_MS = 5 * 60_000;

export function checkHistory(history: ImportableHistory, tags: TagPair[]): void {
  const now = new Date(Date.now() + CLOCK_SKEW_MS).toISOString();
  const created = history.createdAt;
  if (created !== undefined && created > now) throw new ValidationError("createdAt is in the future");
  if (history.updatedAt !== undefined) {
    if (history.updatedAt > now) throw new ValidationError("updatedAt is in the future");
    if (created !== undefined && history.updatedAt < created) throw new ValidationError("updatedAt is before createdAt");
  }
  const check = (at: string, when: string) => {
    if (when > now) throw new ValidationError(`${at} is in the future`);
    if (created !== undefined && when < created) throw new ValidationError(`${at} is before createdAt`);
  };
  history.revisions?.forEach((r, j) => check(`revision ${j + 1} revised_at`, r.revised_at));
  if (history.tagChanges) {
    // tag → its name now (null: deleted since)
    const held = new Map<string, string | null>();
    let previous = "";
    history.tagChanges.forEach((c, j) => {
      const at = `tag change ${j + 1}`;
      check(`${at} changed_at`, c.changed_at);
      if (c.changed_at < previous) throw new ValidationError(`${at} is earlier than the change before it`);
      previous = c.changed_at;
      // One tag across renames: by its id if the file has it, else by the
      // name it has now (a deleted tag has none: by the name it had)
      const { prefix, value } = c.tag ?? c;
      const name = `${prefix}:${value}`;
      const key = c.tagId !== undefined ? `#${c.tagId}` : name;
      if (c.action === "added" ? held.has(key) : !held.has(key)) {
        throw new ValidationError(`${at}: ${c.prefix}:${c.value} is ${c.action} but ${c.action === "added" ? "was already there" : "was not there"}`);
      }
      if (c.action === "added") held.set(key, c.tag === null ? null : name);
      else held.delete(key);
    });
    // A tag no change mentions was there before its history is known: a
    // ticket restored from a file without tag changes holds such tags, and
    // its own backup has to restore
    const mentioned = new Set(history.tagChanges.map((c) => {
      const { prefix, value } = c.tag ?? c;
      return `${prefix}:${value}`;
    }));
    const expected = new Set(tags.map((t) => `${t.prefix}:${t.value}`).filter((name) => mentioned.has(name)));
    const names = [...held.values()];
    if (names.length !== expected.size || names.some((k) => k === null || !expected.has(k))) {
      throw new ValidationError("tagChanges do not end in the ticket's tags");
    }
  }
}

export type PendingHistoryRow = { sequence?: number; at: string } & (
  | { ticketId: number; revision: ImportableRevision }
  | { ticketId: number; tagChange: ImportableTagChange }
  | { deletion: SerializedDeletion }
);

const DELETION_KEYS = ["title", "createdAt", "deletedAt", "sequence"];

/** The deleted tickets export json --with-history writes */
export function parseDeletions(raw: unknown): SerializedDeletion[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const now = new Date(Date.now() + CLOCK_SKEW_MS).toISOString();
  return list(raw, "deletions").map((d, i) => {
    const at = `Deletion ${i + 1}`;
    checkKeys(d, DELETION_KEYS, at);
    // As a revision's title: written by the rules of its time
    if (typeof d.title !== "string" || d.title.length === 0 || d.title.includes("\0") || hasUnpairedSurrogate(d.title) || d.title.length > 10_000) {
      throw new ValidationError(`${at}: title must be a non-empty string without null bytes or unpaired surrogates`);
    }
    const deletedAt = timestamp(d.deletedAt, `${at} deletedAt`);
    const createdAt = d.createdAt === null || d.createdAt === undefined ? null : timestamp(d.createdAt, `${at} createdAt`);
    if (deletedAt > now) throw new ValidationError(`${at}: deletedAt is in the future`);
    if (createdAt !== null && createdAt > deletedAt) throw new ValidationError(`${at}: createdAt is after deletedAt`);
    return { title: d.title, createdAt, deletedAt, ...sequence(d.sequence, at) };
  });
}

/** Deleted tickets as history rows, written in their place among the others */
export const deletionRows = (deletions: SerializedDeletion[]): PendingHistoryRow[] =>
  deletions.map((deletion) => ({ sequence: deletion.sequence, at: deletion.deletedAt, deletion }));

// A ticket id no ticket has, for a restored deletion: the exporting
// database's id could be a live ticket's here. AUTOINCREMENT never hands
// out a deleted row's id again
async function deletedTicketId(db: DB, projectId: number): Promise<number> {
  const [{ id }] = await db.all<{ id: number }>(
    `INSERT INTO tickets (project_id, title) VALUES (?, ?) RETURNING id`,
    projectId,
    `import-${Date.now()}-${Math.random()}`
  );
  await db.run(`DELETE FROM tickets WHERE id = ?`, id);
  return id;
}

// Put back what `export json --with-history` recorded, so lead and cycle
// times and the event log survive a backup and restore. The creation time is
// set right away; revisions and tag changes are returned to be written later.
export async function prepareHistory(db: DB, ticketId: number, history: ImportableHistory): Promise<PendingHistoryRow[]> {
  if (history.createdAt) {
    await db.run(`UPDATE tickets SET created_at = ? WHERE id = ?`, history.createdAt, ticketId);
  }
  // Else the ticket's last update would be the import
  const updated = history.updatedAt ?? history.createdAt;
  if (updated) await db.run(`UPDATE tickets SET updated_at = ? WHERE id = ?`, updated, ticketId);
  // Assigning the ticket's tags just now logged them with today's date. With
  // tag changes in the file those replace them; without, but with an older
  // createdAt, when the tags were added is unknown: keep no date rather than
  // today's (a ticket from 2020 tagged done showed a lead time of 2,459 days)
  if (history.tagChanges || history.createdAt) {
    await db.run(`DELETE FROM ticket_tag_changes WHERE ticket_id = ?`, ticketId);
  }
  return [
    ...(history.revisions ?? []).map((revision) => ({ ticketId, sequence: revision.sequence, at: revision.revised_at, revision })),
    ...(history.tagChanges ?? []).map((tagChange) => ({ ticketId, sequence: tagChange.sequence, at: tagChange.changed_at, tagChange })),
  ];
}

// A tag id no tag has: AUTOINCREMENT never hands out a deleted row's id again
async function deletedTagId(db: DB, projectId: number): Promise<number> {
  const [{ id }] = await db.all<{ id: number }>(
    `INSERT INTO tags (project_id, prefix, value) VALUES (?, 'deleted', ?) RETURNING id`,
    projectId,
    `import-${Date.now()}-${Math.random()}`
  );
  await db.run(`DELETE FROM tags WHERE id = ?`, id);
  return id;
}

// Write history rows in their original write order; rows without a sequence
// (older files) come after, by timestamp and then position in the file.
// Returns the number of tags created for tag changes whose tag no longer
// existed.
export async function writeHistory(db: DB, projectId: number, rows: PendingHistoryRow[]): Promise<number> {
  let tagsCreated = 0;
  // Tags deleted in the exporting project: their changes keep an id of their
  // own that no tag has, as they did there (creating the tag brought it back)
  const deleted = new Map<string, number>();
  const key = (row: PendingHistoryRow) => row.sequence ?? Infinity;
  const sorted = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      key(a.row) !== key(b.row) ? (key(a.row) < key(b.row) ? -1 : 1)
      : a.row.at !== b.row.at ? (a.row.at < b.row.at ? -1 : 1)
      : a.index - b.index)
    .map(({ row }) => row);
  for (const row of sorted) {
    if ("deletion" in row) {
      const d = row.deletion;
      await db.run(
        `INSERT INTO ticket_deletions (project_id, ticket_id, title, created_at, deleted_at) VALUES (?, ?, ?, ?, ?)`,
        projectId, await deletedTicketId(db, projectId), d.title, d.createdAt, d.deletedAt
      );
      continue;
    }
    if ("revision" in row) {
      const r = row.revision;
      await db.run(
        `INSERT INTO ticket_revisions (ticket_id, title, description, benefit, penalty, estimate, risk, tags, revised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.ticketId, r.title, r.description, r.benefit, r.penalty, r.estimate, r.risk, JSON.stringify(r.tags), r.revised_at
      );
      continue;
    }
    const c = row.tagChange;
    if (c.tag === null) {
      const key = c.tagId !== undefined ? `#${c.tagId}` : `${c.prefix}:${c.value}`;
      let id = deleted.get(key);
      if (id === undefined) id = await deletedTagId(db, projectId);
      deleted.set(key, id);
      await db.run(
        `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        row.ticketId, id, c.prefix, c.value, c.action, c.changed_at
      );
      continue;
    }
    // Link the change to the tag as it is named now, so lead and cycle
    // times (which follow the tag, not its old name) come out the same
    const { prefix, value } = c.tag ?? c;
    const { tag, created } = await ensureTag(db, projectId, prefix, value);
    if (created) tagsCreated++;
    await db.run(
      `INSERT INTO ticket_tag_changes (ticket_id, tag_id, prefix, value, action, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      row.ticketId, tag.id, c.prefix, c.value, c.action, c.changed_at
    );
  }
  return tagsCreated;
}
