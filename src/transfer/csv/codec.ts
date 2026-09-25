import { ValidationError } from "../../errors.js";

// CSV rows as rw writes and reads them (RFC 4180), with the guard against
// spreadsheet formulas in both directions

// Cells whose first character is one of these can be interpreted as a formula
// by spreadsheet apps (Excel/Sheets), so we neutralise them with a leading
// apostrophe. Values that already start with an apostrophe get one too, so
// the importer can always strip exactly one guard (stripCsvFormulaGuard).
const NEEDS_GUARD = /^[=+\-@\t\r']/;

function escapeCsvField(field: string): string {
  const value = NEEDS_GUARD.test(field) ? `'${field}` : field;
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

// Reverse the formula-injection guard applied on export: a leading apostrophe
// that precedes a spreadsheet formula trigger is stripped so round-tripping a
// title/description through export -> import is lossless (NEEDS_GUARD).
export function stripCsvFormulaGuard(field: string): string {
  return /^'[=+\-@\t\r']/.test(field) ? field.slice(1) : field;
}

// Parse the whole input at once (RFC 4180): quoted fields may contain commas,
// escaped quotes ("") and line breaks, so we cannot split into lines first.
// Each record with its row number: data rows count from 1 after the header,
// blank lines included, so an error names the row as it appears in the file
export function parseCsv(csv: string): { fields: string[]; row: number }[] {
  const records: { fields: string[]; row: number }[] = [];
  let seen = 0; // records ended so far, blank lines included
  let headerAt: number | undefined;
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoted = false; // the current field was quoted and its quotes are closed

  // Malformed quoting used to be read leniently, and an unclosed quote then
  // swallowed the rest of the file into one field
  const fail = (problem: string): never => {
    const where = headerAt === undefined ? "Header" : `Row ${seen + 1 - headerAt}`;
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
    seen++;
    if (fields.length > 1 || fields[0].trim().length > 0 || recordQuoted) {
      headerAt ??= seen;
      records.push({ fields, row: seen - headerAt });
    }
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
