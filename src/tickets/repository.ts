import { DB } from "../db/connection.js";
import { Fibonacci, assertFibonacci } from "../db/types.js";
import { AppError, MAX_TICKET_TITLE, ValidationError, collapseSpaces, normalizeName } from "../validation/strings.js";
import { getTicketTags } from "../tags/assignment.js";

export interface Ticket {
  id: number;
  ticket_uuid: string;
  project_id: number;
  title: string;
  description: string | null;
  benefit: Fibonacci;
  penalty: Fibonacci;
  estimate: Fibonacci;
  risk: Fibonacci;
  created_at: string;
  updated_at: string;
}

export interface CreateTicketInput {
  projectId: number;
  title: string;
  description?: string;
  benefit?: number;
  penalty?: number;
  estimate?: number;
  risk?: number;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  benefit?: number;
  penalty?: number;
  estimate?: number;
  risk?: number;
}

function validateScores(input: {
  benefit?: number;
  penalty?: number;
  estimate?: number;
  risk?: number;
}): void {
  if (input.benefit !== undefined) assertFibonacci(input.benefit, "benefit");
  if (input.penalty !== undefined) assertFibonacci(input.penalty, "penalty");
  if (input.estimate !== undefined) assertFibonacci(input.estimate, "estimate");
  if (input.risk !== undefined) assertFibonacci(input.risk, "risk");
}

// Whitespace alone is no description: stored as null, like ""
const blankToNull = (description: string | undefined): string | null =>
  description === undefined || description.trim() === "" ? null : description;

export async function createTicket(
  db: DB,
  input: CreateTicketInput
): Promise<Ticket> {
  // One write transaction: the title check and the write must not interleave
  // with another process (which let two tickets get the same title)
  return db.transaction(async () => {
    validateScores(input);

    // The project may have been deleted since the caller looked it up
    if ((await db.all(`SELECT 1 FROM projects WHERE id = ?`, input.projectId)).length === 0) {
      throw new AppError("Project not found (it may just have been deleted)");
    }

    const existing = await getTicketByTitle(db, input.projectId, input.title);
    if (existing) {
      throw new ValidationError(`A ticket with title "${input.title}" already exists in this project`);
    }

    const rows = await db.all<Ticket>(
      `INSERT INTO tickets (project_id, title, description, benefit, penalty, estimate, risk)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      input.projectId,
      input.title,
      blankToNull(input.description), // "" and "   " are no description, stored as null
      input.benefit ?? 1,
      input.penalty ?? 1,
      input.estimate ?? 1,
      input.risk ?? 1
    );
    return rows[0];
  });
}

export interface TagFilter {
  prefix: string;
  value: string;
}

export async function listTickets(
  db: DB,
  projectId: number,
  options?: {
    includeTags?: TagFilter[];
    excludeTags?: TagFilter[];
    search?: string;
  }
): Promise<Ticket[]> {
  let sql = `SELECT t.* FROM tickets t WHERE t.project_id = ?`;
  const params: unknown[] = [projectId];

  // One flat subquery per direction, whatever the number of tags: an
  // EXISTS per tag hit SQLite's expression depth limit at about 1,000 filters.
  // Repeated filters count once. The tags go in as one JSON parameter: two
  // parameters per tag hit SQLite's limit of 32,766 at 16,384 filters.
  const distinct = (tags: TagFilter[] = []) => [...new Map(tags.map((t) => [`${t.prefix}:${t.value}`, t])).values()];
  const tagList = (tags: TagFilter[]) => {
    params.push(JSON.stringify(tags.map((t) => [t.prefix, t.value])));
    return "SELECT value ->> 0, value ->> 1 FROM json_each(?)";
  };

  // Intersection: the ticket has every included tag
  const include = distinct(options?.includeTags);
  if (include.length > 0) {
    sql += `
      AND t.id IN (
        SELECT tt.ticket_id FROM ticket_tags tt
        JOIN tags tg ON tg.id = tt.tag_id
        WHERE (tg.prefix, tg.value) IN (${tagList(include)})
        GROUP BY tt.ticket_id
        HAVING count(*) = ?
      )`;
    params.push(include.length);
  }

  // The ticket has none of the excluded tags
  const exclude = distinct(options?.excludeTags);
  if (exclude.length > 0) {
    sql += `
      AND NOT EXISTS (
        SELECT 1 FROM ticket_tags tt
        JOIN tags tg ON tg.id = tt.tag_id
        WHERE tt.ticket_id = t.id AND (tg.prefix, tg.value) IN (${tagList(exclude)})
      )`;
  }

  // Title search (case-insensitive). Escape LIKE wildcards so a literal
  // "%" or "_" in the search term matches itself instead of acting as a
  // pattern (a bare "%" previously matched every ticket).
  // Titles are stored trimmed and NFC-normalised, so match the query in the same form
  if (options?.search) {
    const term = collapseSpaces(normalizeName(options.search));
    // No title is longer than this, and SQLite refuses LIKE patterns over
    // 50,000 characters (which surfaced as an internal error)
    if (term.length > MAX_TICKET_TITLE) return [];
    const escaped = term
      .toLowerCase()
      .replace(/[\\%_]/g, (c) => `\\${c}`);
    sql += ` AND unicode_lower(collapse_spaces(t.title)) LIKE ? ESCAPE '\\'`;
    params.push(`%${escaped}%`);
  }

  sql += ` ORDER BY t.created_at`;

  return db.all<Ticket>(sql, ...params);
}

export async function getTicketByTitle(
  db: DB,
  projectId: number,
  title: string
): Promise<Ticket | undefined> {
  // Titles are stored with collapsed spaces; tickets created before that may
  // still carry the exact form, which is preferred when both exist
  const exact = normalizeName(title);
  const rows = await db.all<Ticket>(
    `SELECT * FROM tickets WHERE project_id = ? AND title IN (?, ?) ORDER BY title = ? DESC LIMIT 1`,
    projectId,
    exact,
    collapseSpaces(exact),
    exact
  );
  return rows[0];
}

export async function getTicketById(
  db: DB,
  projectId: number,
  id: number
): Promise<Ticket | undefined> {
  const rows = await db.all<Ticket>(
    `SELECT * FROM tickets WHERE project_id = ? AND id = ?`,
    projectId,
    id
  );
  return rows[0];
}

export async function updateTicket(
  db: DB,
  projectId: number,
  ticketId: number,
  input: UpdateTicketInput
): Promise<Ticket> {
  // One write transaction: the title check and the write must not interleave
  // with another process (which let two tickets get the same title)
  return db.transaction(async () => {
    validateScores(input);

    const current = await getTicketById(db, projectId, ticketId);
    if (!current) throw new AppError("Ticket not found");

    // Enforce title uniqueness on rename, mirroring createTicket. Without this,
    // `update --new-title` could rename a ticket onto an existing title, leaving
    // two tickets that share a title and making title-based lookups ambiguous.
    if (input.title !== undefined && input.title !== current.title) {
      const clash = await getTicketByTitle(db, projectId, input.title);
      if (clash) {
        throw new ValidationError(
          `A ticket with title "${input.title}" already exists in this project`
        );
      }
    }

    const title = input.title ?? current.title;
    // An empty or blank description clears it; "no description" is always null
    const description = input.description === undefined ? current.description : blankToNull(input.description);
    const benefit = input.benefit ?? current.benefit;
    const penalty = input.penalty ?? current.penalty;
    const estimate = input.estimate ?? current.estimate;
    const risk = input.risk ?? current.risk;

    // Nothing to do: don't write a revision snapshot or bump updated_at for an
    // update that changes no fields (it would just pollute the history).
    if (
      title === current.title &&
      description === current.description &&
      benefit === current.benefit &&
      penalty === current.penalty &&
      estimate === current.estimate &&
      risk === current.risk
    ) {
      return current;
    }

    // Snapshot the current state before mutating (automatic revision)
    const tags = await getTicketTags(db, current.id);
    const tagSnapshot = JSON.stringify(
      tags.map((t) => ({ prefix: t.prefix, value: t.value }))
    );
    await db.run(
      `INSERT INTO ticket_revisions (ticket_id, title, description, benefit, penalty, estimate, risk, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      current.id, current.title, current.description,
      current.benefit, current.penalty, current.estimate, current.risk,
      tagSnapshot
    );

    const rows = await db.all<Ticket>(
      `UPDATE tickets
       SET title = ?, description = ?, benefit = ?, penalty = ?, estimate = ?, risk = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND project_id = ?
       RETURNING *`,
      title,
      description,
      benefit,
      penalty,
      estimate,
      risk,
      ticketId,
      projectId
    );
    return rows[0];
  });
}

export interface UpsertTicketResult {
  ticket: Ticket;
  action: "created" | "updated" | "unchanged";
}

export async function upsertTicket(
  db: DB,
  projectId: number,
  title: string,
  input: UpdateTicketInput
): Promise<UpsertTicketResult> {
  // One write transaction: the title check and the write must not interleave
  // with another process (which let two tickets get the same title)
  return db.transaction(async () => {
    const existing = await getTicketByTitle(db, projectId, title);

    if (!existing) {
      const ticket = await createTicket(db, {
        projectId,
        title,
        description: input.description,
        benefit: input.benefit,
        penalty: input.penalty,
        estimate: input.estimate,
        risk: input.risk,
      });
      return { ticket, action: "created" };
    }

    validateScores(input);
    const ticket = await updateTicket(db, projectId, existing.id, input);
    const changed = (["title", "description", "benefit", "penalty", "estimate", "risk"] as const).some(
      (field) => ticket[field] !== existing[field]
    );
    return { ticket, action: changed ? "updated" : "unchanged" };
  });
}

export async function deleteTicket(
  db: DB,
  projectId: number,
  ticketId: number
): Promise<boolean> {
  // All or nothing: a failure part-way left a ticket without its history but
  // with a deletion record, and parallel deletes each recorded a deletion
  return db.transaction(async () => {
    const ticket = await getTicketById(db, projectId, ticketId);
    if (!ticket) return false;

    // Remembered so project diffs can report the deletion
    await db.run(
      `INSERT INTO ticket_deletions (project_id, ticket_id, title, created_at) VALUES (?, ?, ?, ?)`,
      projectId,
      ticketId,
      ticket.title,
      ticket.created_at
    );

    // The schema has no ON DELETE CASCADE, so we cascade manually.
    await db.run(`DELETE FROM ticket_relations WHERE source_id = ? OR target_id = ?`, ticketId, ticketId);
    await db.run(`DELETE FROM ticket_revisions WHERE ticket_id = ?`, ticketId);
    await db.run(`DELETE FROM ticket_tag_changes WHERE ticket_id = ?`, ticketId);
    await db.run(`DELETE FROM ticket_tags WHERE ticket_id = ?`, ticketId);
    await db.run(
      `DELETE FROM tickets WHERE id = ? AND project_id = ?`,
      ticketId,
      projectId
    );
    return true;
  });
}
