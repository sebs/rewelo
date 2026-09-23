import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assertOneValuePerPrefix, assignTag } from "../tags/assignment.js";
import { assertFibonacci } from "../db/types.js";
import { ValidationError, parseTagPair, validateTagPrefix, validateTagValue, validateTicketTitle } from "../validation/strings.js";
import type { TagPair } from "../serialization/export-project.js";

const MAX_ROWS = 100_000;
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

interface CsvRow {
  title: string;
  description: string;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: TagPair[];
}

// Reverse the formula-injection guard applied on export: a leading apostrophe
// that precedes a spreadsheet formula trigger is stripped so round-tripping a
// title/description through export -> import is lossless (see export/csv.ts).
function stripCsvFormulaGuard(field: string): string {
  return /^'[=+\-@\t\r']/.test(field) ? field.slice(1) : field;
}

// Parse the whole input at once (RFC 4180): quoted fields may contain commas,
// escaped quotes ("") and line breaks, so we cannot split into lines first.
function parseCsv(csv: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;

  const endRecord = () => {
    fields.push(current);
    // Skip blank lines
    if (fields.length > 1 || fields[0].trim().length > 0) records.push(fields);
    fields = [];
    current = "";
  };

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r" && csv[i + 1] === "\n") {
      // CRLF line ending: the \n ends the record
    } else {
      current += ch;
    }
  }
  endRecord();
  return records;
}

// Empty cells default to 1. Anything else must be a whole number: parseInt
// would silently turn "5.9" into 5 and "3abc" into 3.
function parseScore(raw: string | undefined, field: string): number {
  if (!raw) return 1;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new ValidationError(`${field} must be a number, got "${raw}"`);
  return n;
}

function parseRows(csv: string): CsvRow[] {
  const records = parseCsv(csv);
  if (records.length === 0) throw new ValidationError("CSV is empty");

  const headers = records[0].map((h) => h.trim().toLowerCase());
  if (!headers.includes("title")) {
    throw new ValidationError("Missing required CSV column: title");
  }

  if (records.length - 1 > MAX_ROWS) {
    throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const fields = records[i];
    // Keep free text exactly as written; trim only structured cells
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const field = fields[idx] ?? "";
      row[h] = h === "title" || h === "description" ? field : field.trim();
    });

    let benefit: number, penalty: number, estimate: number, risk: number;
    try {
      benefit = parseScore(row.benefit, "benefit");
      penalty = parseScore(row.penalty, "penalty");
      estimate = parseScore(row.estimate, "estimate");
      risk = parseScore(row.risk, "risk");
      assertFibonacci(benefit, "benefit");
      assertFibonacci(penalty, "penalty");
      assertFibonacci(estimate, "estimate");
      assertFibonacci(risk, "risk");
    } catch (e) {
      throw new ValidationError(`Row ${i + 1}: ${(e as Error).message}`);
    }

    let title: string;
    try {
      title = validateTicketTitle(stripCsvFormulaGuard(row.title ?? ""));
    } catch (e) {
      throw new ValidationError(`Row ${i + 1}: ${(e as Error).message}`);
    }

    let tags: TagPair[];
    try {
      tags = (row.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((raw) => {
          const { prefix, value } = parseTagPair(raw);
          return { prefix: validateTagPrefix(prefix), value: validateTagValue(value) };
        });
      assertOneValuePerPrefix(tags);
    } catch (e) {
      throw new ValidationError(`Row ${i + 1}: ${(e as Error).message}`);
    }

    rows.push({
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
    for (const row of rows) {
      const ticket = await createTicket(db, {
        projectId,
        title: row.title,
        description: row.description || undefined,
        benefit: row.benefit,
        penalty: row.penalty,
        estimate: row.estimate,
        risk: row.risk,
      });

      for (const { prefix, value } of row.tags) {
        let tag = await getTag(db, projectId, prefix, value);
        if (!tag) tag = await createTag(db, projectId, prefix, value);
        await assignTag(db, ticket.id, tag.id);
      }
    }

    return { imported: rows.length };
  });
}
