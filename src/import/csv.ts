import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assertOneValuePerPrefix, assignTag } from "../tags/assignment.js";
import { assertFibonacci } from "../db/types.js";
import { ValidationError, parseTagPair, validateTagPrefix, validateTagValue, validateTicketDescription, validateTicketTitle } from "../validation/strings.js";
import type { TagPair } from "../serialization/export-project.js";

const MAX_ROWS = 100_000;

// Columns written by `rw export csv`; value, cost and priority
// (--with-calculations) are derived from the scores and ignored.
const KNOWN_COLUMNS = ["title", "description", "benefit", "penalty", "estimate", "risk", "tags", "value", "cost", "priority"];
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
  let quoted = false; // the current field was quoted and its quotes are closed

  // Malformed quoting used to be read leniently, and an unclosed quote then
  // swallowed the rest of the file into one field
  const fail = (problem: string): never => {
    const where = records.length === 0 ? "Header" : `Row ${records.length}`;
    throw new ValidationError(`${where}: ${problem}`);
  };
  let recordQuoted = false; // a field of the current record was quoted
  const endField = () => {
    fields.push(current);
    current = "";
    recordQuoted ||= quoted;
    quoted = false;
  };
  const endRecord = () => {
    endField();
    // Skip blank lines, but not a record holding a quoted blank field ("  "):
    // that is a row with an empty title, to be reported
    if (fields.length > 1 || fields[0].trim().length > 0 || recordQuoted) records.push(fields);
    fields = [];
    recordQuoted = false;
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
          quoted = true;
        }
      } else {
        current += ch;
      }
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      // CRLF: the \n ends the record. A lone CR (classic Mac line ending)
      // ends it itself; appending it made the whole file one header row.
      if (csv[i + 1] !== "\n") endRecord();
    } else if (quoted) {
      fail(`unexpected character after a closing quote`);
    } else if (ch === '"') {
      // A quote may only open a field (after optional blanks)
      if (current.trim() !== "") fail(`a quote inside an unquoted field; quote the whole field and double inner quotes`);
      current = "";
      inQuotes = true;
    } else {
      current += ch;
    }
  }
  if (inQuotes) fail("a quoted field is never closed");
  endRecord();
  return records;
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

  const headers = records[0].map((h) => h.trim().toLowerCase());
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
    const fields = records[i];
    if (fields.length > headers.length) {
      throw new ValidationError(`Row ${i}: ${fields.length} fields but only ${headers.length} columns`);
    }
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
      throw new ValidationError(`Row ${i}: ${(e as Error).message}`);
    }

    let title: string;
    try {
      title = validateTicketTitle(stripCsvFormulaGuard(row.title ?? ""));
      validateTicketDescription(stripCsvFormulaGuard(row.description ?? ""));
    } catch (e) {
      throw new ValidationError(`Row ${i}: ${(e as Error).message}`);
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
      throw new ValidationError(`Row ${i}: ${(e as Error).message}`);
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
    for (const [i, row] of rows.entries()) {
      let ticket;
      try {
        ticket = await createTicket(db, {
          projectId,
          title: row.title,
          description: row.description || undefined,
          benefit: row.benefit,
          penalty: row.penalty,
          estimate: row.estimate,
          risk: row.risk,
        });
      } catch (e) {
        // e.g. a title already taken, in the project or earlier in the file
        if (e instanceof ValidationError) throw new ValidationError(`Row ${i + 1}: ${e.message}`);
        throw e;
      }

      for (const { prefix, value } of row.tags) {
        let tag = await getTag(db, projectId, prefix, value);
        if (!tag) tag = await createTag(db, projectId, prefix, value);
        await assignTag(db, ticket.id, tag.id);
      }
    }

    return { imported: rows.length };
  });
}
