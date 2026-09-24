import { assertFibonacci } from "../db/types.js";
import { ValidationError, isBlank, validateTagPrefix, validateTagValue, validateTicketDescription, validateTicketTitle } from "../validation/strings.js";
import type { SerializedRelation, SerializedWeights, TagPair } from "./export-project.js";
import { isValidRelationType } from "../relations/types.js";
import { validateWeights } from "../weights/repository.js";
import { assertOneValuePerPrefix, MAX_TAGS_PER_TICKET } from "../tags/assignment.js";
import type { ImportableHistory, ImportableTicket } from "./import-project.js";
import { normalizeSince } from "../validation/timestamps.js";

export const MAX_JSON_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_NESTING_DEPTH = 10;

export function checkDepth(obj: unknown, depth: number = 0): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw new ValidationError(`JSON nesting depth exceeds maximum of ${MAX_NESTING_DEPTH}`);
  }
  if (Array.isArray(obj)) {
    for (const item of obj) checkDepth(item, depth + 1);
  } else if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      checkDepth(val, depth + 1);
    }
  }
}

export function checkJsonSize(json: string, label: string = "JSON"): void {
  if (Buffer.byteLength(json, "utf-8") > MAX_JSON_SIZE_BYTES) {
    throw new ValidationError(`${label} exceeds maximum file size of 50 MB`);
  }
}

export function safeParseJson(json: string, label: string = "JSON"): unknown {
  try {
    // Editors on Windows often save UTF-8 with a byte order mark
    return JSON.parse(json.replace(/^\uFEFF/, ""));
  } catch {
    throw new ValidationError(`Invalid ${label}`);
  }
}

export function parseTags(raw: unknown, errorPrefix: string = "Tag"): TagPair[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError(`${errorPrefix}s must be an array of {"prefix", "value"} objects`);
  }
  return raw.map((tag, i) => {
    const t = tag as Record<string, unknown>;
    if (!t || typeof t !== "object" || typeof t.prefix !== "string" || typeof t.value !== "string") {
      throw new ValidationError(
        `${errorPrefix} ${i + 1}: must be an object with string "prefix" and "value"`
      );
    }
    try {
      return { prefix: validateTagPrefix(t.prefix), value: validateTagValue(t.value) };
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }
  });
}

export function parseTickets(
  raw: unknown[],
  errorPrefix: string = "Ticket"
): ImportableTicket[] {
  if (raw.length > 100_000) {
    throw new ValidationError("Exceeds maximum of 100,000 tickets");
  }

  const tickets: ImportableTicket[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as Record<string, unknown>;
    if (!t || typeof t !== "object") {
      throw new ValidationError(`${errorPrefix} ${i + 1}: must be an object`);
    }
    if (typeof t.title !== "string" || t.title.length === 0) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: title is required`);
    }

    // Missing scores default to 1, as in CSV import and ticket create.
    // Anything else must be a JSON number: Number() would read true as 1,
    // "5" and [3] as numbers and "0x5" as 5.
    let benefit: number, penalty: number, estimate: number, risk: number;
    try {
      const score = (field: string) => {
        const v = t[field];
        if (v === undefined || v === null) return 1;
        if (typeof v !== "number") throw new ValidationError(`${field} must be a number, got ${JSON.stringify(v)}`);
        return v;
      };
      benefit = score("benefit");
      penalty = score("penalty");
      estimate = score("estimate");
      risk = score("risk");
      assertFibonacci(benefit, "benefit");
      assertFibonacci(penalty, "penalty");
      assertFibonacci(estimate, "estimate");
      assertFibonacci(risk, "risk");
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }

    const tags = parseTags(t.tags, `${errorPrefix} ${i + 1}: tag`);
    try {
      if (tags && tags.length > MAX_TAGS_PER_TICKET) throw new ValidationError(`at most ${MAX_TAGS_PER_TICKET} tags per ticket`);
      if (tags) assertOneValuePerPrefix(tags);
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }

    let title: string;
    try {
      title = validateTicketTitle(t.title);
      if (t.description !== undefined && t.description !== null && typeof t.description !== "string") {
        throw new ValidationError(`description must be a string, got ${JSON.stringify(t.description)}`);
      }
      if (typeof t.description === "string") validateTicketDescription(t.description);
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }

    let history: ImportableHistory | undefined;
    try {
      history = parseHistory(t);
      if (history) checkHistory(history, tags ?? []);
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }

    tickets.push({
      title,
      description: typeof t.description === "string" ? t.description : undefined,
      benefit,
      penalty,
      estimate,
      risk,
      tags,
      ...(history ? { history } : {}),
    });
  }

  return tickets;
}

export function parseRelations(raw: unknown): SerializedRelation[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError('Relations must be an array of {"source", "type", "target"} objects');
  }
  if (raw.length > 100_000) throw new ValidationError("Exceeds maximum of 100,000 relations");
  return raw.map((rel, i) => {
    const r = rel as Record<string, unknown>;
    if (!r || typeof r !== "object" || typeof r.source !== "string" || typeof r.type !== "string" || typeof r.target !== "string") {
      throw new ValidationError(`Relation ${i + 1}: must be an object with string "source", "type" and "target"`);
    }
    if (!isValidRelationType(r.type)) {
      throw new ValidationError(`Relation ${i + 1}: unknown relation type "${r.type}"`);
    }
    return { source: r.source, type: r.type, target: r.target };
  });
}

export function parseWeights(raw: unknown): SerializedWeights | undefined {
  if (raw === undefined || raw === null) return undefined;
  const w = raw as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw) || [w.w1, w.w2, w.w3, w.w4].some((v) => typeof v !== "number")) {
    throw new ValidationError('Weights must be an object with numeric "w1", "w2", "w3" and "w4"');
  }
  const weights = { w1: w.w1 as number, w2: w.w2 as number, w3: w.w3 as number, w4: w.w4 as number };
  try {
    validateWeights(weights.w1, weights.w2, weights.w3, weights.w4);
  } catch (e) {
    throw new ValidationError(`Weights: ${(e as Error).message}`);
  }
  return weights;
}

function timestamp(raw: unknown, field: string): string {
  if (typeof raw !== "string") throw new ValidationError(`${field} must be an ISO timestamp`);
  try {
    return normalizeSince(raw);
  } catch {
    throw new ValidationError(`${field} must be an ISO timestamp`);
  }
}

function sequence(raw: unknown, at: string): { sequence?: number } {
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
function parseHistory(t: Record<string, unknown>): ImportableHistory | undefined {
  if (t.createdAt === undefined && t.revisions === undefined && t.tagChanges === undefined) return undefined;
  const history: ImportableHistory = {};
  if (t.createdAt !== undefined) history.createdAt = timestamp(t.createdAt, "createdAt");
  if (t.revisions !== undefined) {
    history.revisions = list(t.revisions, "revisions").map((r, j) => {
      const at = `revision ${j + 1}`;
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
      if (r.title.length === 0 || r.title.includes("\0") || r.title.length > 10_000) {
        throw new ValidationError(`${at}: title must be a non-empty string without null bytes`);
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

function checkHistory(history: ImportableHistory, tags: TagPair[]): void {
  const now = new Date(Date.now() + CLOCK_SKEW_MS).toISOString();
  const created = history.createdAt;
  if (created !== undefined && created > now) throw new ValidationError("createdAt is in the future");
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
    const expected = new Set(tags.map((t) => `${t.prefix}:${t.value}`));
    const names = [...held.values()];
    if (names.length !== expected.size || names.some((k) => k === null || !expected.has(k))) {
      throw new ValidationError("tagChanges do not end in the ticket's tags");
    }
  }
}
