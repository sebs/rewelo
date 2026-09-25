import { Command } from "commander";
import { relativeWeights, weightedRanking } from "../../app/priorities.js";
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
    .action(async (cmdOpts: ProjectOptions & WeightOptions & { tag: string[] }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const { w1, w2, w3, w4 } = cmdOpts;
        const { weights, tickets } = await weightedRanking(db, project.id, {
          tags: cmdOpts.tag,
          weights: { w1, w2, w3, w4 },
        });
        printRows(opts, tickets, {
          quiet: (r) => `${r.title}\t${r.weighted.toFixed(2)}`,
          empty: "No tickets found.",
          above: [`Weights: w1=${weights.w1} w2=${weights.w2} w3=${weights.w3} w4=${weights.w4}\n`],
          headers: ["Title", "Priority", "Weighted"],
          row: (r) => [r.title, r.priority.toFixed(2), r.weighted.toFixed(2)],
        });
      });
    });
}
