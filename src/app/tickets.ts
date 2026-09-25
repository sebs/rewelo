import { DB } from "../db/connection.js";
import { listTickets, getTicketByTitle, Ticket } from "../tickets/repository.js";
import { byPriority, exactPriority, priority } from "../calculations/priority.js";
import { AppError, ValidationError } from "../errors.js";
import { parseTag } from "../validation/strings.js";

// Use cases shared by the CLI and the MCP server: each takes plain input,
// returns plain data and throws AppError, and leaves presentation to them.

export const SORT_FIELDS = ["priority", "value", "cost", "benefit", "penalty", "estimate", "risk"] as const;

export interface TicketQuery {
  /** prefix:value; a ticket must have every one */
  tags?: string[];
  /** prefix:value; a ticket must have none */
  excludeTags?: string[];
  /** Title substring, case-insensitive */
  search?: string;
  /** Compared with the exact value / cost, not the rounded priority */
  minPriority?: number;
  minValue?: number;
  maxCost?: number;
  /** One of SORT_FIELDS, descending */
  sort?: string;
  offset?: number;
  /** No limit when undefined */
  limit?: number;
}

export type TicketView = Ticket & { value: number; cost: number; priority: number };

/** Tickets with value, cost and priority, filtered, sorted and paged */
export async function queryTickets(
  db: DB,
  projectId: number,
  query: TicketQuery
): Promise<{ total: number; offset: number; items: TicketView[] }> {
  const includeTags = (query.tags ?? []).map((s) => parseTag(s));
  const excludeTags = (query.excludeTags ?? []).map((s) => parseTag(s));
  const tickets = await listTickets(db, projectId, {
    includeTags: includeTags.length > 0 ? includeTags : undefined,
    excludeTags: excludeTags.length > 0 ? excludeTags : undefined,
    search: query.search,
  });

  let items: TicketView[] = tickets.map((t) => ({
    ...t,
    value: t.benefit + t.penalty,
    cost: t.estimate + t.risk,
    priority: priority(t),
  }));

  const { minPriority, minValue, maxCost } = query;
  if (minPriority != null) items = items.filter((t) => exactPriority(t) >= minPriority);
  if (minValue != null) items = items.filter((t) => t.value >= minValue);
  if (maxCost != null) items = items.filter((t) => t.cost <= maxCost);

  if (query.sort !== undefined) {
    if (!(SORT_FIELDS as readonly string[]).includes(query.sort)) {
      throw new ValidationError(`Invalid sort field "${query.sort}". Valid fields: ${SORT_FIELDS.join(", ")}`);
    }
    const key = query.sort as (typeof SORT_FIELDS)[number];
    items.sort(key === "priority" ? byPriority : (a, b) => b[key] - a[key]);
  }

  const total = items.length;
  const offset = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : offset + query.limit;
  return { total, offset, items: items.slice(offset, end) };
}

/** The ticket with this title, or an AppError naming the title */
export async function requireTicket(db: DB, projectId: number, title: string): Promise<Ticket> {
  const ticket = await getTicketByTitle(db, projectId, title);
  if (!ticket) throw new AppError(`Ticket "${title}" not found`);
  return ticket;
}
