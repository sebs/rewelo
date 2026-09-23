import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assignTag } from "../tags/assignment.js";
import { assertFibonacci } from "../db/types.js";
import { ValidationError, parseTagPair, validateTagPrefix, validateTagValue } from "../validation/strings.js";
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
  return /^'[=+\-@\t\r]/.test(field) ? field.slice(1) : field;
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
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = fields[idx]?.trim() ?? "";
    });

    const benefit = row.benefit ? parseInt(row.benefit, 10) : 1;
    const penalty = row.penalty ? parseInt(row.penalty, 10) : 1;
    const estimate = row.estimate ? parseInt(row.estimate, 10) : 1;
    const risk = row.risk ? parseInt(row.risk, 10) : 1;

    try {
      assertFibonacci(benefit, "benefit");
      assertFibonacci(penalty, "penalty");
      assertFibonacci(estimate, "estimate");
      assertFibonacci(risk, "risk");
    } catch (e) {
      throw new ValidationError(`Row ${i + 1}: ${(e as Error).message}`);
    }

    if (!row.title || row.title.length === 0) {
      throw new ValidationError(`Row ${i + 1}: title must not be empty`);
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
    } catch (e) {
      throw new ValidationError(`Row ${i + 1}: ${(e as Error).message}`);
    }

    rows.push({
      title: stripCsvFormulaGuard(row.title),
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
