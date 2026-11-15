import { Command } from "commander";
import { relativeWeights, weightedRanking } from "../../app/priorities.js";
import { EFFORTS, planCapacity, type Effort } from "../../app/capacity-plan.js";
import { ValidationError } from "../../errors.js";
import { round2 } from "../../calculations/priority.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, collect, parseFloatOption, type ProjectOptions, type WeightOptions } from "../options.js";
import { printRows } from "../output.js";

export function registerCalcCommands(program: Command): void {
  const calcCmd = program.command("calc").description("calculation commands");

  calcCmd
    .command("weights")
    .description("show relative weights for tickets")
    .option(...PROJECT_OPTION)
    .option("--tag <prefix:value>", "scope to tickets with this tag (repeatable, intersection)", collect, [] as string[])
    .action(async (cmdOpts: ProjectOptions & { tag: string[] }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        // Several --tag options narrow the scope together, as in ticket list
        const results = await relativeWeights(db, project.id, { tags: cmdOpts.tag });

        // Two decimals, without claiming a non-zero share is 0
        // round2 rounds halves up (0.075 -> 0.08); toFixed alone gave 0.07
        // CSV is for machines: the full value, never "<0.01"
        const share = (x: number) =>
          opts.csv ? String(x) : x > 0 && x < 0.005 ? "<0.01" : round2(x).toFixed(2);
        printRows(opts, results, {
          quiet: (r) => [r.title, r.relativeBenefit, r.relativePenalty, r.relativeEstimate, r.relativeRisk].join("\t"),
          empty: "No tickets found.",
          headers: ["Title", "Rel.Benefit", "Rel.Penalty", "Rel.Estimate", "Rel.Risk"],
          row: (r) => [r.title, share(r.relativeBenefit), share(r.relativePenalty), share(r.relativeEstimate), share(r.relativeRisk)],
        });
      });
    });

  calcCmd
    .command("priority")
    .description("show weighted priorities")
    .option(...PROJECT_OPTION)
    .option("--tag <prefix:value>", "only tickets with this tag (repeatable, intersection)", collect, [] as string[])
    .option("--w1 <n>", "benefit weight", parseFloatOption)
    .option("--w2 <n>", "penalty weight", parseFloatOption)
    .option("--w3 <n>", "estimate weight", parseFloatOption)
    .option("--w4 <n>", "risk weight", parseFloatOption)
    .option("--unblocked", "leave out tickets an open ticket blocks (blocks, depends-on)")
    .action(async (cmdOpts: ProjectOptions & WeightOptions & { tag: string[]; unblocked?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const { w1, w2, w3, w4 } = cmdOpts;
        const { weights, tickets } = await weightedRanking(db, project.id, {
          tags: cmdOpts.tag,
          weights: { w1, w2, w3, w4 },
          unblocked: cmdOpts.unblocked,
        });
        // The column only when a ticket is blocked: most backlogs have none
        const blocked = tickets.some((t) => t.blockedBy);
        printRows(opts, tickets, {
          quiet: (r) => `${r.title}\t${r.weighted.toFixed(2)}`,
          empty: "No tickets found.",
          above: [`Weights: w1=${weights.w1} w2=${weights.w2} w3=${weights.w3} w4=${weights.w4}\n`],
          headers: ["Title", "Priority", "Weighted", ...(blocked ? ["Blocked by"] : [])],
          row: (r) => [r.title, r.priority.toFixed(2), r.weighted.toFixed(2), ...(blocked ? [(r.blockedBy ?? []).join(", ")] : [])],
        });
      });
    });

  calcCmd
    .command("plan")
    .description("open tickets that fit a capacity, by priority, with their blockers first")
    .option(...PROJECT_OPTION)
    .requiredOption("--capacity <n>", "the capacity, in the unit of effort", parseFloatOption)
    .option("--effort <estimate|cost>", "what a ticket takes: its estimate, or estimate + risk", "estimate")
    .option("--tag <prefix:value>", "only plan tickets with this tag (repeatable, intersection)", collect, [] as string[])
    .option("--exclude-tag <prefix:value>", "don't plan tickets with this tag, e.g. state:wip (repeatable); still pulled in as blockers", collect, [] as string[])
    .action(async (cmdOpts: ProjectOptions & { capacity: number; effort: string; tag: string[]; excludeTag: string[] }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      if (!(EFFORTS as readonly string[]).includes(cmdOpts.effort)) {
        throw new ValidationError(`--effort must be ${EFFORTS.join(" or ")}, got "${cmdOpts.effort}"`);
      }
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const plan = await planCapacity(db, project.id, { capacity: cmdOpts.capacity, effort: cmdOpts.effort as Effort, tags: cmdOpts.tag, excludeTags: cmdOpts.excludeTag });
        printRows(opts, plan.tickets, {
          json: plan,
          quiet: (r) => r.title,
          empty: "No open ticket fits the capacity.",
          isEmpty: plan.tickets.length === 0,
          above: [`Capacity ${plan.capacity} (${plan.effort}): ${plan.used} used, ${plan.remaining} left\n`],
          headers: ["#", "Title", "Rank", "Effort", "Weighted", "For"],
          row: (r, i) => [i + 1, r.title, r.rank ?? "-", r.effort, r.weighted.toFixed(2), (r.for ?? []).join(", ")],
          below: plan.skipped.length ? [`\nDidn't fit: ${plan.skipped.map((s) => `${s.title} (needs ${s.needs})`).join(", ")}`] : [],
        });
      });
    });
}
