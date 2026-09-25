import { assertScores } from "../../domain/scores.js";
import { validateWeights } from "../../domain/weights.js";
import { prefixErrors, ValidationError } from "../../errors.js";
import { isValidRelationType } from "../../relations/types.js";
import { assertOneValuePerPrefix, MAX_TAGS_PER_TICKET } from "../../tags/assignment.js";
import { checkHistory, parseHistory } from "./history.js";
import { parseTags } from "./values.js";
import type { ImportableTicket, SerializedRelation, SerializedWeights } from "../types.js";
import { validateTicketDescription, validateTicketTitle } from "../../validation/strings.js";

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
    const at = `${errorPrefix} ${i + 1}`;
    const rawTitle = t.title;
    if (typeof rawTitle !== "string" || rawTitle.length === 0) {
      throw new ValidationError(`${at}: title is required`);
    }

    // Missing scores default to 1, as in CSV import and ticket create.
    // Anything else must be a JSON number: Number() would read true as 1,
    // "5" and [3] as numbers and "0x5" as 5.
    const { benefit, penalty, estimate, risk } = prefixErrors(at, () => {
      const score = (field: string) => {
        const v = t[field];
        if (v === undefined || v === null) return 1;
        if (typeof v !== "number") throw new ValidationError(`${field} must be a number, got ${JSON.stringify(v)}`);
        return v;
      };
      const scores = { benefit: score("benefit"), penalty: score("penalty"), estimate: score("estimate"), risk: score("risk") };
      assertScores(scores);
      return scores;
    });

    const tags = parseTags(t.tags, `${at}: tag`);
    prefixErrors(at, () => {
      if (tags && tags.length > MAX_TAGS_PER_TICKET) throw new ValidationError(`at most ${MAX_TAGS_PER_TICKET} tags per ticket`);
      if (tags) assertOneValuePerPrefix(tags);
    });

    const title = prefixErrors(at, () => {
      const valid = validateTicketTitle(rawTitle);
      if (t.description !== undefined && t.description !== null && typeof t.description !== "string") {
        throw new ValidationError(`description must be a string, got ${JSON.stringify(t.description)}`);
      }
      if (typeof t.description === "string") validateTicketDescription(t.description);
      return valid;
    });

    const history = prefixErrors(at, () => {
      const parsed = parseHistory(t);
      if (parsed) checkHistory(parsed, tags ?? []);
      return parsed;
    });

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
  prefixErrors("Weights", () => validateWeights(weights));
  return weights;
}
