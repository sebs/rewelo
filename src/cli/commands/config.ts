import { Command } from "commander";
import { getWeights, resetWeights } from "../../weights/repository.js";
import { updateWeights } from "../../app/priorities.js";
import type { Weights } from "../../domain/weights.js";
import { ValidationError } from "../../errors.js";
import { withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, parseFloatOption, type ProjectOptions, type WeightOptions } from "../options.js";
import { formatTable, printResult } from "../output.js";

const weightList = (w: Weights) => `w1=${w.w1} w2=${w.w2} w3=${w.w3} w4=${w.w4}`;

export function registerConfigCommands(program: Command): void {
  const configCmd = program.command("config").description("configuration commands");

  configCmd
    .command("weights")
    .description("view or manage weight configuration")
    .option(...PROJECT_OPTION)
    .option("--set", "set the weights given with --w1..--w4 (at least one; the others keep their value)")
    .option("--reset", "reset weights to defaults")
    .option("--w1 <n>", "benefit weight", parseFloatOption)
    .option("--w2 <n>", "penalty weight", parseFloatOption)
    .option("--w3 <n>", "estimate weight", parseFloatOption)
    .option("--w4 <n>", "risk weight", parseFloatOption)
    .action(async (cmdOpts: ProjectOptions & WeightOptions & { set?: boolean; reset?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      // Reject combinations that would otherwise be silently ignored
      const givesWeights = (["w1", "w2", "w3", "w4"] as const).some((w) => cmdOpts[w] !== undefined);
      if (cmdOpts.set && cmdOpts.reset) throw new ValidationError("Use either --set or --reset, not both");
      if (cmdOpts.set && !givesWeights) throw new ValidationError("--set needs at least one of --w1, --w2, --w3, --w4");
      if (!cmdOpts.set && givesWeights) {
        throw new ValidationError(cmdOpts.reset ? "Use either --set or --reset, not both" : "Pass --set to change weights");
      }
      await withProject(opts, cmdOpts.project, async (db, project) => {
        if (cmdOpts.reset) {
          const config = await resetWeights(db, project.id);
          printResult(opts, config, `Reset weights for "${project.name}" to defaults: ${weightList(config)}`);
        } else if (cmdOpts.set) {
          const { w1, w2, w3, w4 } = cmdOpts;
          const config = await updateWeights(db, project.id, { w1, w2, w3, w4 });
          printResult(opts, config, `Set weights for "${project.name}": ${weightList(config)}`);
        } else {
          const config = await getWeights(db, project.id);
          if (opts.json) {
            console.log(JSON.stringify(config));
          } else if (opts.quiet) {
            console.log([config.w1, config.w2, config.w3, config.w4].join("\t"));
          } else if (opts.csv) {
            console.log(formatTable(opts, ["w1", "w2", "w3", "w4"], [[config.w1, config.w2, config.w3, config.w4]]));
          } else {
            console.log(`Weights for "${project.name}": ${weightList(config)}`);
          }
        }
      });
    });
}
