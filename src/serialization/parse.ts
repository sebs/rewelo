import { assertFibonacci } from "../db/types.js";
import { ValidationError, validateTagPrefix, validateTagValue, validateTicketDescription, validateTicketTitle } from "../validation/strings.js";
import type { SerializedRelation, SerializedWeights, TagPair } from "./export-project.js";
import { isValidRelationType } from "../relations/types.js";
import { validateWeights } from "../weights/repository.js";
import { assertOneValuePerPrefix } from "../tags/assignment.js";
import type { ImportableTicket } from "./import-project.js";

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

    // Missing scores default to 1, as in CSV import and ticket create
    const score = (v: unknown) => (v === undefined || v === null ? 1 : Number(v));
    const benefit = score(t.benefit);
    const penalty = score(t.penalty);
    const estimate = score(t.estimate);
    const risk = score(t.risk);

    try {
      assertFibonacci(benefit, "benefit");
      assertFibonacci(penalty, "penalty");
      assertFibonacci(estimate, "estimate");
      assertFibonacci(risk, "risk");
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }

    const tags = parseTags(t.tags, `${errorPrefix} ${i + 1}: tag`);
    try {
      if (tags) assertOneValuePerPrefix(tags);
    } catch (e) {
      throw new ValidationError(`${errorPrefix} ${i + 1}: ${(e as Error).message}`);
    }

    let title: string;
    try {
      title = validateTicketTitle(t.title);
      if (typeof t.description === "string") validateTicketDescription(t.description);
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
    });
  }

  return tickets;
}

export function parseRelations(raw: unknown): SerializedRelation[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new ValidationError('Relations must be an array of {"source", "type", "target"} objects');
  }
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
