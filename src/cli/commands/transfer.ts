import { statSync } from "node:fs";
import { Command } from "commander";
import { exportCsv } from "../../transfer/csv/export.js";
import { writeJsonExport } from "../../transfer/json/export.js";
import { toFile, toStdout } from "../../transfer/json/stream.js";
import { importCsv, MAX_SIZE_BYTES as MAX_CSV_BYTES } from "../../transfer/csv/import.js";
import { importDataAsProject, parseImportJson } from "../../transfer/json/import.js";
import { MAX_JSON_SIZE_BYTES } from "../../transfer/json/values.js";
import { validateExportPath, validateImportPath } from "../../validation/paths.js";
import { describeFsError } from "../../errors.js";
import { resolveProjectName, withDb, withProject, type GlobalOptions } from "../context.js";
import { PROJECT_OPTION, type ProjectOptions } from "../options.js";
import { printResult, reportWritten } from "../output.js";
import { readImportFile, writeFile } from "../files.js";

const tickets = (n: number) => `Imported ${n} ticket${n === 1 ? "" : "s"}`;

export function registerTransferCommands(program: Command): void {
  const exportCmd = program.command("export").description("export project data");

  exportCmd
    .command("csv")
    .description("export tickets as CSV")
    .option(...PROJECT_OPTION)
    .option("--output <path>", "output file path")
    .option("--with-calculations", "include value, cost, priority columns")
    .action(async (cmdOpts: ProjectOptions & { output?: string; withCalculations?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const csv = await exportCsv(db, project.id, {
          withCalculations: cmdOpts.withCalculations,
        });
        if (cmdOpts.output !== undefined) {
          const outPath = validateExportPath(cmdOpts.output, [".csv"]);
          writeFile(outPath, csv);
          reportWritten(opts, outPath, `Exported to ${outPath}`);
        } else {
          process.stdout.write(csv);
        }
      });
    });

  exportCmd
    .command("json")
    .description("export project data as JSON")
    .option(...PROJECT_OPTION)
    .option("--output <path>", "output file path")
    .option("--with-history", "include revisions and tag change log")
    .action(async (cmdOpts: ProjectOptions & { output?: string; withHistory?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const options = { withHistory: cmdOpts.withHistory };
        if (cmdOpts.output !== undefined) {
          const outPath = validateExportPath(cmdOpts.output, [".json"]);
          await writeJsonExport(db, project.id, options, toFile(outPath)).catch((err) => {
            // File errors name the path; errors reading the database pass on
            throw (err as NodeJS.ErrnoException).syscall ? describeFsError(err, "write", outPath) : err;
          });
          reportWritten(opts, outPath, `Exported to ${outPath}`);
          const size = statSync(outPath).size;
          if (size > MAX_JSON_SIZE_BYTES) {
            // As the import would refuse it (readImportFile)
            console.error(`Warning: ${outPath} is ${(size / 1024 / 1024).toFixed(1)} MB; imports take at most ${MAX_JSON_SIZE_BYTES / 1024 / 1024} MB, so it can't be imported as it is`);
          }
        } else {
          await writeJsonExport(db, project.id, options, toStdout);
        }
      });
    });

  const importCmd = program.command("import").description("import project data");

  importCmd
    .command("csv <file>")
    .description("import tickets from CSV")
    .option(...PROJECT_OPTION)
    .action(async (file: string, cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      await withProject(opts, cmdOpts.project, async (db, project) => {
        const csv = readImportFile(validateImportPath(file, [".csv"]), MAX_CSV_BYTES);
        const result = await importCsv(db, project.id, csv);
        printResult(opts, result, tickets(result.imported));
      });
    });

  importCmd
    .command("json <file>")
    .description("import project data from JSON (creates the project if needed)")
    .option(...PROJECT_OPTION)
    .action(async (file: string, cmdOpts: ProjectOptions, cmd: Command) => {
      const opts = cmd.optsWithGlobals<GlobalOptions>();
      const name = resolveProjectName(cmdOpts.project);
      // Read and check the file before the database is created: a failed
      // import must not leave a new, empty database behind
      const data = parseImportJson(readImportFile(validateImportPath(file, [".json"]), MAX_JSON_SIZE_BYTES));
      await withDb(opts, async (db) => {
        const result = await importDataAsProject(db, name, data);
        const { relationsCreated: n, weights: w } = result;
        printResult(opts, result, [
          ...(result.projectCreated ? [`Created project "${name}"`] : []),
          tickets(result.imported),
          ...(n > 0 ? [`Created ${n} relation${n === 1 ? "" : "s"}`] : []),
          ...(w ? [`Set the weights to w1=${w.w1} w2=${w.w2} w3=${w.w3} w4=${w.w4}`] : []),
        ]);
      }, { create: true });
    });
}
