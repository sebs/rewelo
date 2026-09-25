import { DB } from "../../db/connection.js";
import { assertScores } from "../../domain/scores.js";
import { prefixErrors, prefixValidationErrors, ValidationError } from "../../errors.js";
import { assertOneValuePerPrefix, assignTag, MAX_TAGS_PER_TICKET } from "../../tags/assignment.js";
import { ensureTag } from "../../tags/repository.js";
import { createTicket } from "../../tickets/repository.js";
import { parseCsv, stripCsvFormulaGuard } from "./codec.js";
import type { TagPair } from "../types.js";
import { parseTagPair, validateTagPrefix, validateTagValue, validateTicketDescription, validateTicketTitle } from "../../validation/strings.js";

const MAX_ROWS = 100_000;

// Columns written by `rw export csv`; value, cost and priority
// (--with-calculations) are derived from the scores and ignored.
const KNOWN_COLUMNS = ["title", "description", "benefit", "penalty", "estimate", "risk", "tags", "value", "cost", "priority"];

export const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

interface CsvRow {
  /** Row number in the file (blank lines counted) */
  row: number;
  title: string;
  description: string;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: TagPair[];
}

// Empty cells default to 1. Anything else must be written as a whole number:
// parseInt would silently turn "5.9" into 5 and "3abc" into 3, and Number
// reads "0x5", "1e0" and "+3" as numbers too.
function parseScore(raw: string | undefined, field: string): number {
  if (!raw) return 1;
  // Plain digits only: "5.0" and "08" are not how a score is written
  if (/^\d*\.\d*$/.test(raw) || /^0\d/.test(raw)) {
    throw new ValidationError(`${field} must be a whole number without leading zeros, got "${raw}"`);
  }
  if (!/^\d+$/.test(raw)) throw new ValidationError(`${field} must be a number, got "${raw}"`);
  return Number(raw);
}

function parseRows(csv: string): CsvRow[] {
  const records = parseCsv(csv);
  if (records.length === 0) throw new ValidationError("CSV is empty");

  const headers = records[0].fields.map((h) => h.trim().toLowerCase());
  if (!headers.includes("title")) {
    throw new ValidationError("Missing required CSV column: title");
  }
  // A misspelt column (benfit) would otherwise be dropped silently, and its
  // scores default to 1
  const unknown = headers.filter((h) => !KNOWN_COLUMNS.includes(h));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Unknown CSV column${unknown.length > 1 ? "s" : ""}: ${unknown.map((h) => `"${h}"`).join(", ")}. Known columns: ${KNOWN_COLUMNS.join(", ")}`
    );
  }
  const duplicate = headers.find((h, i) => headers.indexOf(h) !== i);
  if (duplicate !== undefined) {
    throw new ValidationError(`Duplicate CSV column: "${duplicate}"`);
  }

  if (records.length - 1 > MAX_ROWS) {
    throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const { fields, row: rowNumber } = records[i];
    if (fields.length > headers.length) {
      throw new ValidationError(`Row ${rowNumber}: ${fields.length} fields but only ${headers.length} columns`);
    }
    // Keep free text exactly as written; trim only structured cells
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const field = fields[idx] ?? "";
      row[h] = h === "title" || h === "description" ? field : field.trim();
    });

    const at = `Row ${rowNumber}`;
    const { benefit, penalty, estimate, risk } = prefixErrors(at, () => {
      const scores = {
        benefit: parseScore(row.benefit, "benefit"),
        penalty: parseScore(row.penalty, "penalty"),
        estimate: parseScore(row.estimate, "estimate"),
        risk: parseScore(row.risk, "risk"),
      };
      assertScores(scores);
      return scores;
    });

    const title = prefixErrors(at, () => {
      const valid = validateTicketTitle(stripCsvFormulaGuard(row.title ?? ""));
      validateTicketDescription(stripCsvFormulaGuard(row.description ?? ""));
      return valid;
    });

    const tags: TagPair[] = prefixErrors(at, () => {
      const pairs = (row.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((raw) => {
          const { prefix, value } = parseTagPair(raw);
          return { prefix: validateTagPrefix(prefix), value: validateTagValue(value) };
        });
      if (pairs.length > MAX_TAGS_PER_TICKET) throw new ValidationError(`at most ${MAX_TAGS_PER_TICKET} tags per ticket`);
      assertOneValuePerPrefix(pairs);
      return pairs;
    });

    rows.push({
      row: rowNumber,
      title,
      description: stripCsvFormulaGuard(row.description ?? ""),
      benefit,
      penalty,
      estimate,
      risk,
      tags,
    });
  }

  return rows;
}

export async function importCsv(
  db: DB,
  projectId: number,
  csv: string
): Promise<{ imported: number }> {
  if (Buffer.byteLength(csv, "utf-8") > MAX_SIZE_BYTES) {
    throw new ValidationError("CSV exceeds maximum file size of 50 MB");
  }

  // Validate all rows first (atomic: all or nothing)
  const rows = parseRows(csv);

  return db.transaction(async () => {
    const firstRow = new Map<string, number>();
    for (const row of rows) {
      // Titles are normalised by now, so "café" (NFC/NFD) or "a  b" repeat here
      const earlier = firstRow.get(row.title);
      if (earlier !== undefined) {
        throw new ValidationError(`Row ${row.row}: title "${row.title}" is the same as row ${earlier}'s`);
      }
      firstRow.set(row.title, row.row);
      // e.g. a title already taken, in the project or earlier in the file
      const ticket = await prefixValidationErrors(`Row ${row.row}`, () =>
        createTicket(db, {
          projectId,
          title: row.title,
          description: row.description || undefined,
          benefit: row.benefit,
          penalty: row.penalty,
          estimate: row.estimate,
          risk: row.risk,
        })
      );

      for (const { prefix, value } of row.tags) {
        const { tag } = await ensureTag(db, projectId, prefix, value);
        await assignTag(db, ticket.id, tag.id);
      }
    }

    return { imported: rows.length };
  });
}
