import type { McpServer, ServerContext, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DB } from "../db/connection.js";
import { getTicketById, getTicketByTitle, Ticket } from "../tickets/repository.js";
import type { Project } from "../projects/repository.js";
import { AppError } from "../errors.js";
import { FIBONACCI, type Fibonacci } from "../domain/scores.js";
import type { ReweloConfig } from "../config.js";
import type { DbSession } from "./session.js";

// What the modules registering tools, prompts and resources share

export interface McpContext {
  server: McpServer;
  /** The .rewelo.json found at startup ({} when there is none, or it is broken) */
  config: ReweloConfig;
  /** Register a tool: strict input, its output schema, the payload limit, write tracking, and errors as error results (safe) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool(name: string, description: string, shape: z.ZodRawShape, annotations: ToolAnnotations, handler: (args: any, ctx: ServerContext) => any): void;
  withDb: DbSession["withDb"];
  withProject: DbSession["withProject"];
  /** The project a call names, or the .rewelo.json default */
  resolveProject(project: string | undefined): string;
  /** Run fn in the project a call names (its project parameter), or the default one */
  inProject<T>(project: string | undefined, fn: (db: DB, project: Project) => Promise<T>): Promise<T>;
  /** Whether the client can show the user a form (elicitation) */
  canAskUser(): boolean;
}

export async function resolveTicket(db: DB, projectId: number, title?: string, id?: number): Promise<Ticket> {
  if (!title && id === undefined) throw new AppError("Provide either title or id");
  if (title && id !== undefined) throw new AppError("Provide either title or id, not both");
  const ticket = id !== undefined
    ? await getTicketById(db, projectId, id)
    : await getTicketByTitle(db, projectId, title!);
  if (!ticket) throw new AppError(title ? `Ticket "${title}" not found` : `Ticket #${id} not found`);
  return ticket;
}

// Every tool says what it does to the database, so a client can run the
// read-only ones without asking and warn before the destructive ones.
// Nothing reaches outside the local database (openWorldHint false).
export const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
// Only adds data; an existing title or name is an error, not overwritten
export const ADDS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Overwrites or removes data
export const CHANGES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
// As CHANGES, but a repeated call with the same arguments changes nothing more
export const CHANGES_IDEMPOTENT: ToolAnnotations = { ...CHANGES, idempotentHint: true };
export const DELETES: ToolAnnotations = CHANGES_IDEMPOTENT;

// The same message as the CLI's, not zod's bare "Invalid input"
export const fibonacciScore = z.union(
  FIBONACCI.map((n) => z.literal(n)) as [z.ZodLiteral<Fibonacci>, ...z.ZodLiteral<Fibonacci>[]],
  { error: (issue) => `must be a Fibonacci value (${FIBONACCI.join(", ")}), got ${JSON.stringify(issue.input)}` }
);

/** The project parameter of every tool that works on one project */
export const PROJECT_ARG = { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") };

// The tag and tags parameters as the one tag list the use cases take
export const tagList = (tag: string | undefined, tags: string[] = []): string[] => (tag !== undefined ? [tag] : []).concat(tags);
