import { z } from "zod";
import { exportCsv } from "../../transfer/csv/export.js";
import { importCsv } from "../../transfer/csv/import.js";
import { importJsonAsProject } from "../../transfer/json/import.js";
import { documentOrLink, jsonExport, resourceUri } from "../documents.js";
import { MAX_RESULT_BYTES } from "../results.js";
import { ADDS, CHANGES, READ, PROJECT_ARG, type McpContext } from "../toolkit.js";

export function registerTransferTools(ctx: McpContext): void {
  const { tool, withDb, inProject, resolveProject } = ctx;

  tool(
    "export_csv",
    "Export all tickets as CSV. Optionally includes calculated value, cost, and priority columns. Over 5 MB, returns a link to the resource with the CSV instead.",
    {
      ...PROJECT_ARG,
      withCalculations: z.boolean().optional().describe("Include value/cost/priority columns"),
    },
    READ,
    ({ project, withCalculations }) =>
      inProject(project, (db, proj) =>
        documentOrLink(
          () => exportCsv(db, proj.id, { withCalculations }),
          resourceUri(proj.name, `export/${withCalculations ? "csv-with-calculations" : "csv"}`),
          "CSV export",
          "text/csv"
        )
      )
  );

  tool(
    "export_json",
    "Export a project as JSON: tickets, tags, relations and weights; with withHistory also each ticket's createdAt, updatedAt, revisions and tagChanges, and the project's deleted tickets (deletions), so lead and cycle times and the event log survive a restore. Use for backups of a single project; import_json restores it. Over 5 MB, returns a link to the resource with the export instead.",
    {
      ...PROJECT_ARG,
      withHistory: z.boolean().optional().describe("Include each ticket's creation and update time, revisions and tag changes, and the deleted tickets"),
    },
    READ,
    ({ project, withHistory }) =>
      inProject(project, (db, proj) =>
        documentOrLink(
          () => jsonExport(db, proj.id, withHistory ?? false, MAX_RESULT_BYTES),
          resourceUri(proj.name, `export/${withHistory ? "json-with-history" : "json"}`),
          "JSON export",
          "application/json"
        )
      )
  );

  tool(
    "import_csv",
    "Import tickets from CSV string. Only 'title' column is required; missing score columns default to 1. Tags column optional (comma-separated prefix:value). Columns other than title, description, benefit, penalty, estimate, risk, tags (and the calculated value, cost, priority) are rejected.",
    {
      ...PROJECT_ARG,
      csv: z.string().describe("CSV content"),
    },
    ADDS,
    async ({ project, csv }) => {
      return inProject(project, (db, proj) => importCsv(db, proj.id, csv));
    }
  );

  tool(
    "import_json",
    "Import a project from JSON as export_json writes it: {tickets: [{title, description?, benefit?, penalty?, estimate?, risk?, tags?: [{prefix, value}], createdAt?, updatedAt?, revisions?, tagChanges?}], tags?, relations?: [{source, type, target}], weights?: {w1, w2, w3, w4}, deletions?: [{title, createdAt, deletedAt}]}. The history keys (createdAt, updatedAt, revisions, tagChanges, deletions) come from export_json with withHistory: pass them back as they are. Unknown keys are refused. Tags are created as needed and the project if it does not exist. Relations are added, and weights in the file replace the project's; the result reports relationsCreated and the weights set.",
    {
      ...PROJECT_ARG,
      json: z.string().describe("JSON content"),
    },
    CHANGES,
    async ({ project, json }) => {
      return withDb((db) => importJsonAsProject(db, resolveProject(project), json));
    }
  );
}
