import { z } from "zod";
import { applyChanges, type Operation } from "../../app/change-plan.js";
import { CHANGES, fibonacciScore, PROJECT_ARG, type McpContext } from "../toolkit.js";

export function registerChangeTools(ctx: McpContext): void {
  const { tool, inProject } = ctx;

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
  ]) satisfies z.ZodType<Operation>;
  const MAX_OPERATIONS = 1000;

  tool(
    "apply_changes",
    "Apply a list of changes in one transaction: all of them or, when one fails, none. Operations: ticket_create, ticket_update, ticket_delete, tag_assign and tag_remove (tag as prefix:value; a missing tag is created), relation_create, relation_remove, each with the parameters of the tool of that name. With dryRun, nothing is written: the result shows what the changes would do. Returns each operation's outcome and how the ranking (as calc_priority ranks) changes. Use it to groom a backlog in one step, and dryRun to review a plan with the user first.",
    {
      ...PROJECT_ARG,
      operations: z.array(operation).min(1).max(MAX_OPERATIONS).describe("Changes, applied in order"),
      dryRun: z.boolean().optional().describe("Only show what the changes would do (default false)"),
      top: z.number().int().positive().optional().describe("How many top tickets of the new ranking to list (default 10)"),
      limit: z.number().int().nonnegative().optional().describe("Max number of changed or moved tickets to return (default 100)"),
    },
    CHANGES,
    ({ project, operations, dryRun, top, limit }) =>
      inProject(project, (db, proj) =>
        applyChanges(db, proj.id, operations, { dryRun, top: top ?? 10, limit: limit ?? 100 })
      )
  );
}
