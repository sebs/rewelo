import { DB } from "../../src/db/connection.js";
import { writeJsonExport, type ExportedProject, type JsonExportOptions } from "../../src/transfer/json/export.js";

/** The JSON export as rw export json and export_json write it, parsed */
export async function exportJson(db: DB, projectId: number, options: JsonExportOptions = {}): Promise<ExportedProject> {
  let text = "";
  await writeJsonExport(db, projectId, options, async (chunks) => {
    for await (const chunk of chunks) text += chunk;
  });
  return JSON.parse(text);
}
