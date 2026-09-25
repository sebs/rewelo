import { z } from "zod";
import { exportCsv } from "../../export/csv.js";
import { importCsv } from "../../import/csv.js";
import { importJsonAsProject } from "../../import/json.js";
import { documentOrLink, jsonExport, resourceUri } from "../documents.js";
import { MAX_RESULT_BYTES, safe } from "../results.js";
import { ADDS, CHANGES, READ, type McpContext } from "../toolkit.js";

export function registerTransferTools(ctx: McpContext): void {
  const { tool, withDb, withProject, resolveProject } = ctx;

  tool(
    "export_csv",
    "Export all tickets as CSV. Optionally includes calculated value, cost, and priority columns. Over 5 MB, returns a link to the resource with the CSV instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      withCalculations: z.boolean().optional().describe("Include value/cost/priority columns"),
    },
    READ,
    safe(({ project, withCalculations }) =>
      withProject(resolveProject(project), (db, proj) =>
        documentOrLink(
          () => exportCsv(db, proj.id, { withCalculations }),
          resourceUri(proj.name, `export/${withCalculations ? "csv-with-calculations" : "csv"}`),
          "CSV export",
          "text/csv"
        )
      )
    )
  );

  tool(
    "export_json",
    "Export a project as JSON: tickets, tags, relations and weights, and with withHistory each ticket's revisions and tag changes. Use for backups of a single project; import_json restores it. Over 5 MB, returns a link to the resource with the export instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      withHistory: z.boolean().optional().describe("Include revisions and audit log"),
    },
    READ,
    safe(({ project, withHistory }) =>
      withProject(resolveProject(project), (db, proj) =>
        documentOrLink(
          () => jsonExport(db, proj.id, withHistory ?? false, MAX_RESULT_BYTES),
          resourceUri(proj.name, `export/${withHistory ? "json-with-history" : "json"}`),
          "JSON export",
          "application/json"
        )
      )
    )
  );

  tool(
    "import_csv",
    "Import tickets from CSV string. Only 'title' column is required; missing score columns default to 1. Tags column optional (comma-separated prefix:value). Columns other than title, description, benefit, penalty, estimate, risk, tags (and the calculated value, cost, priority) are rejected.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      csv: z.string().describe("CSV content"),
    },
    ADDS,
    safe(async ({ project, csv }) => {
      return withProject(resolveProject(project), (db, proj) => importCsv(db, proj.id, csv));
    })
  );

  tool(
    "import_json",
    "Import a project from JSON as export_json writes it: {tickets: [{title, description?, benefit?, penalty?, estimate?, risk?, tags?: [{prefix, value}]}], tags?, relations?: [{source, type, target}], weights?: {w1, w2, w3, w4}}. Tags are created as needed and the project if it does not exist. Relations are added, and weights in the file replace the project's; the result reports relationsCreated and the weights set.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      json: z.string().describe("JSON content"),
    },
    CHANGES,
    safe(async ({ project, json }) => {
      return withDb((db) => importJsonAsProject(db, resolveProject(project), json));
    })
  );
}
