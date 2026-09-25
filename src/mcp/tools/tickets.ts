import { inputRequired, inputResponse, type PrimitiveSchemaDefinition } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DIMENSIONS, FIBONACCI, isFibonacci, type Dimension } from "../../domain/scores.js";
import { queryTickets } from "../../app/tickets.js";
import { listProjectRevisions, listRevisions } from "../../revisions/repository.js";
import { createTicket, deleteTicket, getTicketByTitle, updateTicket, upsertTicket } from "../../tickets/repository.js";
import { AppError } from "../../errors.js";
import { validateTicketDescription, validateTicketTitle } from "../../validation/strings.js";
import { safe } from "../results.js";
import { ADDS, CHANGES, CHANGES_IDEMPOTENT, DELETES, fibonacciScore, READ, resolveTicket, type McpContext } from "../toolkit.js";

const DEFAULT_TICKET_LIMIT = 100;


// Form fields for scores the user is asked for: a drop-down of the
// Fibonacci values (form enums are strings)
const SCORE_FIELDS: Record<Dimension, PrimitiveSchemaDefinition> = {
  benefit: { type: "string", title: "Benefit", description: "Benefit if delivered", enum: FIBONACCI.map(String) },
  penalty: { type: "string", title: "Penalty", description: "Penalty if not delivered", enum: FIBONACCI.map(String) },
  estimate: { type: "string", title: "Estimate", description: "Implementation effort", enum: FIBONACCI.map(String) },
  risk: { type: "string", title: "Risk", description: "Implementation risk and uncertainty", enum: FIBONACCI.map(String) },
};

// A score from the form: the client's answer is not trusted to be valid
function parseScore(score: string, answer: unknown): number | undefined {
  if (answer === undefined) return undefined;
  const value = Number(answer);
  if (!isFibonacci(value)) {
    throw new AppError(`${score}: must be a Fibonacci value (${FIBONACCI.join(", ")}), got ${JSON.stringify(answer)}`);
  }
  return value;
}

export function registerTicketTools(ctx: McpContext): void {
  const { tool, withProject, resolveProject, canAskUser } = ctx;

  tool(
    "ticket_create",
    "Create a new ticket with Fibonacci scores (1,2,3,5,8,13,21). Title must be unique per project. When the client supports forms (elicitation), the user is asked for omitted scores; otherwise, or when the user declines, they default to 1. Priority = (benefit + penalty) / (estimate + risk). Use ticket_upsert instead if the title may already exist.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title (max 500 chars)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit if delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty if not delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Implementation effort (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Implementation risk/uncertainty (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    ADDS,
    safe(async ({ project, title, description, ...given }, ctx) => {
      const validTitle = validateTicketTitle(title);
      const validDesc = validateTicketDescription(description);
      const projectName = resolveProject(project);
      const missing = DIMENSIONS.filter((score) => given[score] === undefined);
      const answer = inputResponse(ctx.mcpReq.inputResponses, "scores");
      if (missing.length > 0 && answer.kind === "missing" && canAskUser()) {
        // Fail now on a missing project or a taken title, not after the user
        // has filled in the form
        await withProject(projectName, async (db, proj) => {
          if (await getTicketByTitle(db, proj.id, validTitle)) throw new AppError(`A ticket with title "${validTitle}" already exists in this project`);
        });
        return inputRequired({
          inputRequests: {
            scores: inputRequired.elicit({
              message: `Score the new ticket "${validTitle}". Left out, a score is 1.`,
              requestedSchema: {
                type: "object",
                properties: Object.fromEntries(missing.map((score) => [score, SCORE_FIELDS[score]])),
              },
            }),
          },
        });
      }
      if (answer.kind === "elicit" && answer.action === "cancel") {
        throw new AppError(`Ticket "${validTitle}" was not created: the user cancelled.`);
      }
      const asked = answer.kind === "elicit" && answer.action === "accept" ? answer.content ?? {} : {};
      const scores = Object.fromEntries(
        DIMENSIONS.map((score) => [score, given[score] ?? parseScore(score, asked[score])])
      );
      return withProject(projectName, (db, proj) =>
        createTicket(db, { projectId: proj.id, title: validTitle, description: validDesc, ...scores })
      );
    })
  );

  tool(
    "ticket_list",
    "List tickets with calculated value, cost, and priority. Supports tag filters (intersection), exclude-tags, title search, score thresholds, sort, and limit/offset pagination. Returns {total, offset, items[]}.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      tag: z.string().optional().describe("Filter by tag (prefix:value) — single tag, kept for backward compat"),
      tags: z.array(z.string()).optional().describe("Filter by multiple tags (intersection). Each as prefix:value"),
      excludeTags: z.array(z.string()).optional().describe("Exclude tickets with these tags. Each as prefix:value"),
      search: z.string().optional().describe("Filter by title substring (case-insensitive)"),
      sort: z.string().optional().describe("Sort descending by: priority, benefit, penalty, estimate, risk, value, cost"),
      limit: z.number().int().nonnegative().optional().describe("Max number of results to return (default 100; total gives the full count)"),
      offset: z.number().int().nonnegative().optional().describe("Skip first N results (for pagination)"),
      minPriority: z.number().optional().describe("Minimum priority, compared with the exact value/cost (21/13 = 1.615 is below 1.62, though returned as 1.62)"),
      minValue: z.number().optional().describe("Minimum value (benefit+penalty) threshold"),
      maxCost: z.number().optional().describe("Maximum cost (estimate+risk) threshold"),
    },
    READ,
    safe(({ project, tag, tags, excludeTags, search, sort, limit, offset, minPriority, minValue, maxCost }) =>
      withProject(resolveProject(project), (db, proj) =>
        queryTickets(db, proj.id, {
          // An empty tag is no filter here, as it always was
          tags: (tag ? [tag] : []).concat(tags ?? []),
          excludeTags,
          search,
          minPriority,
          minValue,
          maxCost,
          sort,
          offset,
          // Pages of 100 unless a limit is given; total says how many there are
          limit: limit ?? DEFAULT_TICKET_LIMIT,
        })
      )
    )
  );

  tool(
    "ticket_update",
    "Update a ticket's title, description, or scores. Only provided fields are changed. Identified by current title.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Current ticket title"),
      newTitle: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      benefit: fibonacciScore.optional().describe("Benefit score"),
      penalty: fibonacciScore.optional().describe("Penalty score"),
      estimate: fibonacciScore.optional().describe("Estimate score"),
      risk: fibonacciScore.optional().describe("Risk score"),
    },
    CHANGES,
    safe(async ({ project, title, newTitle, description, benefit, penalty, estimate, risk }) => {
      const validNewTitle = newTitle !== undefined ? validateTicketTitle(newTitle) : undefined;
      const validDesc = validateTicketDescription(description);
      return withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title);
        return updateTicket(db, proj.id, ticket.id, {
          title: validNewTitle, description: validDesc, benefit, penalty, estimate, risk,
        });
      });
    })
  );

  tool(
    "ticket_upsert",
    "Create or update a ticket matched by exact title. Returns {ticket, action: 'created'|'updated'|'unchanged'}. Idempotent — safe to call repeatedly without duplicate errors.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title (used as the unique key)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit score (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty score (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Estimate score (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Risk score (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    CHANGES_IDEMPOTENT,
    safe(async ({ project, title, description, benefit, penalty, estimate, risk }) => {
      const validTitle = validateTicketTitle(title);
      const validDesc = validateTicketDescription(description);
      return withProject(resolveProject(project), async (db, proj) => {
        return upsertTicket(db, proj.id, validTitle, {
          description: validDesc, benefit, penalty, estimate, risk,
        });
      });
    })
  );

  tool(
    "ticket_delete",
    "Delete a ticket and its relations, revisions, and tag assignments. Irreversible.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title"),
    },
    DELETES,
    safe(({ project, title }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title);
        if (!(await deleteTicket(db, proj.id, ticket.id))) throw new AppError(`Ticket "${title}" not found`);
        return { deleted: true };
      })
    )
  );

  tool(
    "ticket_history",
    "Show revision history for a single ticket. Provide title or id. For project-wide history, use project_history instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().optional().describe("Ticket title (provide title or id)"),
      id: z.number().int().positive().optional().describe("Ticket numeric ID (provide title or id)"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of revisions to return (oldest first)"),
      offset: z.number().int().nonnegative().optional().describe("Number of revisions to skip"),
    },
    READ,
    safe(({ project, title, id, limit, offset }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title, id);
        return listRevisions(db, ticket.id, limit, offset);
      })
    )
  );

  tool(
    "project_history",
    "List revision history across all tickets in a project: newest first, or with since the revisions right after it, oldest first. Use instead of calling ticket_history per ticket. Page with limit and offset.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().optional().describe("Only show revisions after this ISO timestamp (then oldest first)"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of revisions to return"),
      offset: z.number().int().nonnegative().optional().describe("Number of revisions to skip"),
    },
    READ,
    safe(({ project, since, limit, offset }) =>
      withProject(resolveProject(project), (db, proj) => listProjectRevisions(db, proj.id, since, limit, offset))
    )
  );
}
