import { DB } from "../db/connection.js";
import { createTicket } from "../tickets/repository.js";
import { createTag, getTag } from "../tags/repository.js";
import { assignTag } from "../tags/assignment.js";
import { assertFibonacci } from "../db/types.js";
import { ValidationError } from "../validation/strings.js";

const MAX_ROWS = 100_000;
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

interface CsvRow {
  title: string;
  description: string;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  tags: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseRows(csv: string): CsvRow[] {
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new ValidationError("CSV is empty");

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const required = ["title", "benefit", "penalty", "estimate", "risk"];
  for (const r of required) {
    if (!headers.includes(r)) {
      throw new ValidationError(`Missing required CSV column: ${r}`);
    }
  }

  if (lines.length - 1 > MAX_ROWS) {
    throw new ValidationError(`CSV exceeds maximum of ${MAX_ROWS} rows`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = fields[idx]?.trim() ?? "";
    });

    const benefit = parseInt(row.benefit, 10);
    const penalty = parseInt(row.penalty, 10);
    const estimate = parseInt(row.estimate, 10);
    const risk = parseInt(row.risk, 10);

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

    rows.push({
      title: row.title,
      description: row.description ?? "",
      benefit,
      penalty,
      estimate,
      risk,
      tags: row.tags ?? "",
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

    if (row.tags) {
      const tagPairs = row.tags.split(",").map((t) => t.trim()).filter(Boolean);
      for (const pair of tagPairs) {
        const [prefix, value] = pair.split(":");
        if (!prefix || !value) continue;
        let tag = await getTag(db, projectId, prefix, value);
        if (!tag) tag = await createTag(db, projectId, prefix, value);
        await assignTag(db, ticket.id, tag.id);
      }
    }
  }

  return { imported: rows.length };
}
