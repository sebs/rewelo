import { DB } from "../db/connection.js";
import { Fibonacci, assertFibonacci } from "../db/types.js";
import { ValidationError } from "../validation/strings.js";

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

export async function createTicket(
  db: DB,
  input: CreateTicketInput
): Promise<Ticket> {
  validateScores(input);

  const existing = await getTicketByTitle(db, input.projectId, input.title);
  if (existing) {
    throw new ValidationError(`A ticket with title "${input.title}" already exists in this project`);
  }

  const rows = await db.all<Ticket>(
    `INSERT INTO rw.tickets (project_id, title, description, benefit, penalty, estimate, risk)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    input.projectId,
    input.title,
    input.description ?? null,
    input.benefit ?? 1,
    input.penalty ?? 1,
    input.estimate ?? 1,
    input.risk ?? 1
  );
  return rows[0];
}

export async function listTickets(
  db: DB,
  projectId: number
): Promise<Ticket[]> {
  return db.all<Ticket>(
    `SELECT * FROM rw.tickets WHERE project_id = ? ORDER BY created_at`,
    projectId
  );
}

export async function getTicketByTitle(
  db: DB,
  projectId: number,
  title: string
): Promise<Ticket | undefined> {
  const rows = await db.all<Ticket>(
    `SELECT * FROM rw.tickets WHERE project_id = ? AND title = ?`,
    projectId,
    title
  );
  return rows[0];
}

export async function getTicketById(
  db: DB,
  projectId: number,
  id: number
): Promise<Ticket | undefined> {
  const rows = await db.all<Ticket>(
    `SELECT * FROM rw.tickets WHERE project_id = ? AND id = ?`,
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
  validateScores(input);

  const current = await getTicketById(db, projectId, ticketId);
  if (!current) throw new Error("Ticket not found");

  const title = input.title ?? current.title;
  const description = input.description ?? current.description;
  const benefit = input.benefit ?? current.benefit;
  const penalty = input.penalty ?? current.penalty;
  const estimate = input.estimate ?? current.estimate;
  const risk = input.risk ?? current.risk;

  const rows = await db.all<Ticket>(
    `UPDATE rw.tickets
     SET title = ?, description = ?, benefit = ?, penalty = ?, estimate = ?, risk = ?, updated_at = now()
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
}

export interface UpsertTicketResult {
  ticket: Ticket;
  action: "created" | "updated";
}

export async function upsertTicket(
  db: DB,
  projectId: number,
  title: string,
  input: UpdateTicketInput
): Promise<UpsertTicketResult> {
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
  return { ticket, action: "updated" };
}

export async function deleteTicket(
  db: DB,
  projectId: number,
  ticketId: number
): Promise<boolean> {
  const ticket = await getTicketById(db, projectId, ticketId);
  if (!ticket) return false;

  // DuckDB does not support ON DELETE CASCADE
  await db.run(`DELETE FROM rw.ticket_relations WHERE source_id = ? OR target_id = ?`, ticketId, ticketId);
  await db.run(`DELETE FROM rw.ticket_revisions WHERE ticket_id = ?`, ticketId);
  await db.run(`DELETE FROM rw.ticket_tag_changes WHERE ticket_id = ?`, ticketId);
  await db.run(`DELETE FROM rw.ticket_tags WHERE ticket_id = ?`, ticketId);
  await db.run(
    `DELETE FROM rw.tickets WHERE id = ? AND project_id = ?`,
    ticketId,
    projectId
  );
  return true;
}
