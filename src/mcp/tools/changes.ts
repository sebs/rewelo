import { z } from "zod";
import { compareRankings } from "../../calculations/scenario.js";
import { DB } from "../../db/connection.js";
import { createRelation, removeRelation } from "../../relations/repository.js";
import { normalizeRelationType } from "../../relations/types.js";
import { assignTag, removeTag } from "../../tags/assignment.js";
import { createTag, getTag } from "../../tags/repository.js";
import { createTicket, deleteTicket, listTickets, updateTicket } from "../../tickets/repository.js";
import { sanitizeError, AppError } from "../../errors.js";
import { parseTag, validateTicketDescription, validateTicketTitle } from "../../validation/strings.js";
import { getWeights } from "../../weights/repository.js";
import { safe } from "../results.js";
import { CHANGES, fibonacciScore, resolveTicket, type McpContext } from "../toolkit.js";

export function registerChangeTools(ctx: McpContext): void {
  const { tool, withProject, resolveProject } = ctx;

  const scores = {
    benefit: fibonacciScore.optional(),
    penalty: fibonacciScore.optional(),
    estimate: fibonacciScore.optional(),
    risk: fibonacciScore.optional(),
  };
  const relation = { source: z.string(), type: z.string(), target: z.string() };
  const operation = z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("ticket_create"), title: z.string(), description: z.string().optional(), ...scores }),
    z.strictObject({ op: z.literal("ticket_update"), title: z.string(), newTitle: z.string().optional(), description: z.string().optional(), ...scores }),
    z.strictObject({ op: z.literal("ticket_delete"), title: z.string() }),
    z.strictObject({ op: z.literal("tag_assign"), ticket: z.string(), tag: z.string().describe("prefix:value") }),
    z.strictObject({ op: z.literal("tag_remove"), ticket: z.string(), tag: z.string().describe("prefix:value") }),
    z.strictObject({ op: z.literal("relation_create"), ...relation }),
    z.strictObject({ op: z.literal("relation_remove"), ...relation }),
  ]);
  type Operation = z.infer<typeof operation>;

  const MAX_OPERATIONS = 1000;

  // Carries a dry run's result out of the transaction it rolls back
  class DryRun {
    constructor(readonly result: unknown) {}
  }

  type TicketChange = "created" | "updated" | "deleted";

  // Applies one operation, and notes in changes how it touched a ticket
  async function applyOperation(db: DB, projectId: number, op: Operation, changes: Map<number, TicketChange>) {
    switch (op.op) {
      case "ticket_create": {
        const { title, description, ...given } = op;
        const t = await createTicket(db, { projectId, title: validateTicketTitle(title), description: validateTicketDescription(description), ...given });
        changes.set(t.id, "created");
        return { op: op.op, title: t.title };
      }
      case "ticket_update": {
        const { title, newTitle, description, ...given } = op;
        const before = await resolveTicket(db, projectId, title);
        const after = await updateTicket(db, projectId, before.id, {
          title: newTitle !== undefined ? validateTicketTitle(newTitle) : undefined,
          description: validateTicketDescription(description),
          ...given,
        });
        if (changes.get(before.id) !== "created") changes.set(before.id, "updated");
        const fields = ["title", "description", "benefit", "penalty", "estimate", "risk"] as const;
        const fieldChanges = fields.filter((f) => before[f] !== after[f]).map((f) => ({ field: f, from: before[f], to: after[f] }));
        return { op: op.op, title: after.title, changes: fieldChanges };
      }
      case "ticket_delete": {
        const t = await resolveTicket(db, projectId, op.title);
        await deleteTicket(db, projectId, t.id);
        // Created and deleted again: as if it never was
        if (changes.get(t.id) === "created") changes.delete(t.id);
        else changes.set(t.id, "deleted");
        return { op: op.op, title: t.title };
      }
      case "tag_assign": {
        const { prefix, value } = parseTag(op.tag);
        const t = await resolveTicket(db, projectId, op.ticket);
        const existing = await getTag(db, projectId, prefix, value);
        const tag = existing ?? (await createTag(db, projectId, prefix, value));
        const { assigned, replaced } = await assignTag(db, t.id, tag.id);
        return {
          op: op.op,
          ticket: t.title,
          tag: `${prefix}:${value}`,
          status: assigned ? "assigned" : "already_assigned",
          ...(replaced.length > 0 ? { replaced } : {}),
          ...(existing ? {} : { tagCreated: true }),
        };
      }
      case "tag_remove": {
        const { prefix, value } = parseTag(op.tag);
        const t = await resolveTicket(db, projectId, op.ticket);
        const tag = await getTag(db, projectId, prefix, value);
        if (!tag) throw new AppError(`Tag ${prefix}:${value} not found`);
        return { op: op.op, ticket: t.title, tag: `${prefix}:${value}`, status: (await removeTag(db, t.id, tag.id)) ? "removed" : "was_not_assigned" };
      }
      case "relation_create":
      case "relation_remove": {
        const source = await resolveTicket(db, projectId, op.source);
        const target = await resolveTicket(db, projectId, op.target);
        if (op.op === "relation_create") await createRelation(db, projectId, source.id, target.id, op.type);
        else await removeRelation(db, projectId, source.id, target.id, op.type);
        return { op: op.op, source: source.title, type: normalizeRelationType(op.type), target: target.title };
      }
    }
  }

  tool(
    "apply_changes",
    "Apply a list of changes in one transaction: all of them or, when one fails, none. Operations: ticket_create, ticket_update, ticket_delete, tag_assign and tag_remove (tag as prefix:value; a missing tag is created), relation_create, relation_remove, each with the parameters of the tool of that name. With dryRun, nothing is written: the result shows what the changes would do. Returns each operation's outcome and how the ranking (as calc_priority ranks) changes. Use it to groom a backlog in one step, and dryRun to review a plan with the user first.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      operations: z.array(operation).min(1).max(MAX_OPERATIONS).describe("Changes, applied in order"),
      dryRun: z.boolean().optional().describe("Only show what the changes would do (default false)"),
      top: z.number().int().positive().optional().describe("How many top tickets of the new ranking to list (default 10)"),
      limit: z.number().int().nonnegative().optional().describe("Max number of changed or moved tickets to return (default 100)"),
    },
    CHANGES,
    safe(({ project, operations, dryRun, top, limit }) =>
      withProject(resolveProject(project), async (db, proj) => {
        try {
          return await db.transaction(async () => {
            const { w1, w2, w3, w4 } = await getWeights(db, proj.id);
            const weights = { w1, w2, w3, w4 };
            const before = await listTickets(db, proj.id, { withDescription: false });
            const results = [];
            const changes = new Map<number, TicketChange>();
            for (const [i, op] of (operations as Operation[]).entries()) {
              try {
                results.push(await applyOperation(db, proj.id, op, changes));
              } catch (err) {
                throw new AppError(`Operation ${i + 1} (${op.op}): ${sanitizeError(err)}. Nothing was changed.`);
              }
            }
            const after = await listTickets(db, proj.id, { withDescription: false });
            const result = {
              applied: !dryRun,
              operations: results,
              // By id: an operation can change a title
              ranking: compareRankings({ tickets: before, weights }, { tickets: after, weights }, (t) => t.id, changes, { top: top ?? 10, limit: limit ?? 100 }),
            };
            // Roll back what a dry run did
            if (dryRun) throw new DryRun(result);
            return result;
          });
        } catch (err) {
          if (err instanceof DryRun) return err.result;
          throw err;
        }
      })
    )
  );
}
