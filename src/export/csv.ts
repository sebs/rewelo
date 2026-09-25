import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getProjectTicketTags } from "../tags/assignment.js";
import { cost, priority, value } from "../calculations/priority.js";

// Cells whose first character is one of these can be interpreted as a formula
// by spreadsheet apps (Excel/Sheets), so we neutralise them with a leading
// apostrophe. Values that already start with an apostrophe get one too, so
// the importer can always strip exactly one guard (see import/csv.ts).
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

export interface CsvExportOptions {
  withCalculations?: boolean;
}

export async function exportCsv(
  db: DB,
  projectId: number,
  options: CsvExportOptions = {}
): Promise<string> {
  // One snapshot, like the JSON export: tickets and their tags as of one moment
  return db.readTransaction(async () => {
    const tickets = await listTickets(db, projectId);
    // Every ticket's tags in one query, not one query per ticket
    const tagsByTicket = await getProjectTicketTags(db, projectId);

    const headers = ["title", "description", "benefit", "penalty", "estimate", "risk", "tags"];
    if (options.withCalculations) {
      headers.push("value", "cost", "priority");
    }

    const lines: string[] = [csvRow(headers)];

    for (const ticket of tickets) {
      const tags = tagsByTicket.get(ticket.id) ?? [];
      const tagStr = tags.map((t) => `${t.prefix}:${t.value}`).join(",");

      const row: string[] = [
        ticket.title,
        ticket.description ?? "",
        String(ticket.benefit),
        String(ticket.penalty),
        String(ticket.estimate),
        String(ticket.risk),
        tagStr,
      ];

      if (options.withCalculations) {
        row.push(String(value(ticket)), String(cost(ticket)), priority(ticket).toFixed(2));
      }

      lines.push(csvRow(row));
    }

    return lines.join("\n") + "\n";
  });
}
