import { DB } from "../db/connection.js";
import { listTickets, Ticket } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function csvRow(fields: string[]): string {
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
  const tickets = await listTickets(db, projectId);

  const headers = ["title", "description", "benefit", "penalty", "estimate", "risk", "tags"];
  if (options.withCalculations) {
    headers.push("value", "cost", "priority");
  }

  const lines: string[] = [csvRow(headers)];

  for (const ticket of tickets) {
    const tags = await getTicketTags(db, ticket.id);
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
      const val = ticket.benefit + ticket.penalty;
      const cost = ticket.estimate + ticket.risk;
      const prio = priority(ticket.benefit, ticket.penalty, ticket.estimate, ticket.risk);
      row.push(String(val), String(cost), prio.toFixed(2));
    }

    lines.push(csvRow(row));
  }

  return lines.join("\n") + "\n";
}
