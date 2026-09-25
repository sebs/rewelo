import { z } from "zod";
import { updateWeights } from "../../app/priorities.js";
import { AppError } from "../../errors.js";
import { getWeights, resetWeights } from "../../weights/repository.js";
import { CHANGES_IDEMPOTENT, READ, PROJECT_ARG, type McpContext } from "../toolkit.js";

export function registerWeightTools(ctx: McpContext): void {
  const { tool, inProject } = ctx;

  tool(
    "weight_get",
    "Get the weight configuration (w1-w4) for a project. Defaults are all 1.5 if not customized.",
    { ...PROJECT_ARG },
    READ,
    ({ project }) => inProject(project, (db, proj) => getWeights(db, proj.id))
  );

  tool(
    "weight_set",
    "Set weight configuration (w1-w4) for a project. Each weight is 0 or between 0.01 and 100. Only provided weights change; omitted ones keep their current value.",
    {
      ...PROJECT_ARG,
      w1: z.number().optional().describe("Benefit weight"),
      w2: z.number().optional().describe("Penalty weight"),
      w3: z.number().optional().describe("Estimate weight"),
      w4: z.number().optional().describe("Risk weight"),
    },
    CHANGES_IDEMPOTENT,
    ({ project, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) => {
      // As rw config weights --set: nothing to set is a mistake, not a no-op
      if ([uw1, uw2, uw3, uw4].every((w) => w === undefined)) throw new AppError("Provide at least one of w1, w2, w3, w4");
      return inProject(project, (db, proj) => updateWeights(db, proj.id, { w1: uw1, w2: uw2, w3: uw3, w4: uw4 }));
    }
  );

  tool(
    "weight_reset",
    "Reset weight configuration to defaults (all 1.5).",
    { ...PROJECT_ARG },
    CHANGES_IDEMPOTENT,
    ({ project }) => inProject(project, (db, proj) => resetWeights(db, proj.id))
  );
}
