import { inputRequired, inputResponse } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getTicketTags } from "../../tags/assignment.js";
import { DB } from "../../db/connection.js";
import type { Ticket } from "../../tickets/repository.js";
import { relativeWeights, ticketsInScope, weightedRanking } from "../../app/priorities.js";
import { explain, findTicket, simulate } from "../../calculations/scenario.js";
import { calibrate, parseSuggestion, scoringPrompt } from "../../reports/calibration.js";
import { getDistribution } from "../../reports/distribution.js";
import { listTickets } from "../../tickets/repository.js";
import { AppError } from "../../errors.js";
import { parseTag, validateTicketDescription, validateTicketTitle } from "../../validation/strings.js";
import { getWeights } from "../../weights/repository.js";
import { doneTicketIds } from "../../workflow/states.js";
import { fibonacciScore, READ, resolveTicket, tagList, PROJECT_ARG, type McpContext } from "../toolkit.js";

// What-if questions are about what to do next: done tickets take no part
// in the ranking, as in the backlog resource, the summary and the dashboard
async function openInScope(db: DB, projectId: number, scope: string[]): Promise<{ open: Ticket[]; done: Ticket[] }> {
  const tickets = await ticketsInScope(db, projectId, scope);
  const doneIds = await doneTicketIds(db, projectId);
  return { open: tickets.filter((t) => !doneIds.has(t.id)), done: tickets.filter((t) => doneIds.has(t.id)) };
}

// A ticket the tools rank within a tag scope: one outside it that exists
// is outside the scope, not "not found", and a done one is done
async function requireInScope(db: DB, projectId: number, { open, done }: { open: Ticket[]; done: Ticket[] }, title: string, scope: string[]): Promise<void> {
  if (findTicket(done, title)) throw new AppError(`Ticket "${title}" is done (state:done); only open tickets are ranked`);
  if (scope.length === 0 || findTicket(open, title)) return;
  const ticket = await resolveTicket(db, projectId, title); // not found
  // The scope tags it lacks, not the ones it has
  const held = new Set((await getTicketTags(db, ticket.id)).map((t) => `${t.prefix}:${t.value}`));
  const missing = [...new Set(scope.map((s) => parseTag(s)).map((t) => `${t.prefix}:${t.value}`))].filter((t) => !held.has(t));
  throw new AppError(`Ticket "${title}" does not have the tag${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`);
}

export function registerCalculationTools(ctx: McpContext): void {
  const { tool, inProject, server } = ctx;

  tool(
    "calc_priority",
    "Calculate weighted priorities for all tickets, sorted descending. Inline w1-w4 override stored weights for this call only. Returns {title, priority, weighted} per ticket. For de-risk-first ordering, use ticket_list with sort='risk' instead.",
    {
      ...PROJECT_ARG,
      tag: z.string().optional().describe("Only tickets with this tag (prefix:value)"),
      tags: z.array(z.string()).optional().describe("Only tickets with all of these tags (intersection, also with tag). Each as prefix:value"),
      w1: z.number().optional().describe("Benefit weight (default 1.5). Higher = benefit matters more in value."),
      w2: z.number().optional().describe("Penalty weight (default 1.5). Higher = penalty matters more in value."),
      w3: z.number().optional().describe("Estimate weight (default 1.5). Higher = large estimates are penalised more."),
      w4: z.number().optional().describe("Risk weight (default 1.5). Higher = risky items are penalised more. To de-risk first, sort by risk via ticket_list instead."),
    },
    READ,
    ({ project, tag, tags, w1, w2, w3, w4 }) =>
      inProject(project, async (db, proj) =>
        (await weightedRanking(db, proj.id, { tags: tagList(tag, tags), weights: { w1, w2, w3, w4 } })).tickets
      )
  );

  tool(
    "calc_weights",
    "Calculate each ticket's relative share of total value and cost as fractions between 0 and 1 (0.25 = 25%). Shows how one ticket compares to the whole backlog, or to a tagged subset when tag is given.",
    {
      ...PROJECT_ARG,
      tag: z.string().optional().describe("Only compare tickets with this tag (prefix:value)"),
      tags: z.array(z.string()).optional().describe("Only compare tickets with all of these tags (intersection, also with tag). Each as prefix:value"),
    },
    READ,
    ({ project, tag, tags }) =>
      inProject(project, (db, proj) => relativeWeights(db, proj.id, { tags: tagList(tag, tags) }))
  );

  const scoreChange = {
    title: z.string().describe("Ticket title"),
    benefit: fibonacciScore.optional(),
    penalty: fibonacciScore.optional(),
    estimate: fibonacciScore.optional(),
    risk: fibonacciScore.optional(),
  };

  tool(
    "simulate",
    "What-if: rank the open tickets (not state:done) as calc_priority does, under hypothetical score changes, new or removed tickets and weights, and compare with the current ranking. Nothing is written; use ticket_update to apply a scenario. Returns the scenario's top tickets and every ticket that is changed, added, removed or moves, with its rank and priority before and after.",
    {
      ...PROJECT_ARG,
      tag: z.string().optional().describe("Only rank tickets with this tag (prefix:value)"),
      tags: z.array(z.string()).optional().describe("Only rank tickets with all of these tags (intersection, also with tag). Each as prefix:value"),
      changes: z.array(z.strictObject(scoreChange)).optional().describe("Hypothetical scores for existing tickets; omitted scores stay"),
      add: z.array(z.strictObject(scoreChange)).optional().describe("Hypothetical new tickets; omitted scores are 1"),
      remove: z.array(z.string()).optional().describe("Titles of tickets to leave out"),
      weights: z.strictObject({ w1: z.number().optional(), w2: z.number().optional(), w3: z.number().optional(), w4: z.number().optional() })
        .optional().describe("Hypothetical weights; omitted ones keep the project's"),
      top: z.number().int().positive().optional().describe("How many of the scenario's top tickets to list (default 10)"),
      limit: z.number().int().nonnegative().optional().describe("Max number of changed or moved tickets to return (default 100)"),
    },
    READ,
    ({ project, tag, tags, changes, add, remove, weights, top, limit }) => {
      for (const t of add ?? []) validateTicketTitle(t.title);
      return inProject(project, async (db, proj) => {
        const scope = tagList(tag, tags);
        const tickets = await openInScope(db, proj.id, scope);
        for (const title of [...(remove ?? []), ...(changes ?? []).map((c: { title: string }) => c.title)]) {
          await requireInScope(db, proj.id, tickets, title, scope);
        }
        const { w1, w2, w3, w4 } = await getWeights(db, proj.id);
        return simulate(tickets.open, { w1, w2, w3, w4 }, { changes, add, remove, weights }, { top: top ?? 10, limit: limit ?? 100 });
      });
    }
  );

  tool(
    "explain_priority",
    "Explain one ticket's priority: the formula with its scores and the project's weights, its rank among the open tickets (not state:done) as calc_priority ranks, and what it would take to reach the top N: the priority to beat, and the smallest change of each single score that gets there.",
    {
      ...PROJECT_ARG,
      title: z.string().describe("Ticket title"),
      tag: z.string().optional().describe("Rank only among tickets with this tag (prefix:value); the ticket must have it"),
      tags: z.array(z.string()).optional().describe("Rank only among tickets with all of these tags (intersection, also with tag); the ticket must have them. Each as prefix:value"),
      top: z.number().int().positive().optional().describe("The rank to reach (default 1)"),
    },
    READ,
    ({ project, title, tag, tags, top }) =>
      inProject(project, async (db, proj) => {
        const scope = tagList(tag, tags);
        const tickets = await openInScope(db, proj.id, scope);
        const { w1, w2, w3, w4 } = await getWeights(db, proj.id);
        await requireInScope(db, proj.id, tickets, title, scope);
        return explain(tickets.open, { w1, w2, w3, w4 }, title, top ?? 1);
      })
  );

  tool(
    "suggest_scores",
    "Material to score a new ticket relative to the project's own backlog, before ticket_create: the most similar existing tickets (possible duplicates) with their scores; for each dimension and each score, the existing ticket closest to the new one as a reference; and the project's score distribution. With sample, and when the client supports MCP sampling, the client's model is also asked for scores, returned as suggestion.",
    {
      ...PROJECT_ARG,
      title: z.string().describe("The new ticket's title"),
      description: z.string().optional().describe("The new ticket's description"),
      sample: z.boolean().optional().describe("Ask the client's model for scores (MCP sampling; the client may ask the user first). Default false"),
    },
    READ,
    async ({ project, title, description, sample }, ctx) => {
      const validTitle = validateTicketTitle(title);
      const validDesc = validateTicketDescription(description);
      const material = await inProject(project, async (db, proj) => {
        const tickets = await listTickets(db, proj.id);
        return { tickets: tickets.length, ...calibrate(tickets, validTitle, validDesc), distribution: await getDistribution(db, proj.id) };
      });
      if (!sample) return material;
      if (!server.server.getClientCapabilities()?.sampling) return { ...material, sampling: "unsupported" };

      const answer = inputResponse(ctx.mcpReq.inputResponses, "scores");
      if (answer.kind === "missing") {
        return inputRequired({
          inputRequests: {
            scores: inputRequired.createMessage({
              messages: [{ role: "user", content: { type: "text", text: scoringPrompt(validTitle, validDesc, material) } }],
              maxTokens: 400,
            }),
          },
        });
      }
      const content = answer.kind === "sampling" ? answer.result.content : undefined;
      const text = [content ?? []].flat().map((c) => (c.type === "text" ? c.text : "")).join("");
      const suggestion = parseSuggestion(text);
      return suggestion ? { ...material, sampling: "used", suggestion } : { ...material, sampling: "failed" };
    }
  );
}
