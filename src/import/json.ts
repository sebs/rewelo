import { DB } from "../db/connection.js";
import { ValidationError } from "../validation/strings.js";
import { importProjectData } from "../serialization/import-project.js";
import { checkDepth, checkJsonSize, safeParseJson, parseTickets, parseTags } from "../serialization/parse.js";
import type { ImportableTicket } from "../serialization/import-project.js";
import type { TagPair } from "../serialization/export-project.js";

interface ImportData {
  tickets: ImportableTicket[];
  tags?: TagPair[];
}

function validateImportData(data: unknown): ImportData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("JSON must be an object with a 'tickets' array");
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.tickets)) {
    throw new ValidationError("JSON must contain a 'tickets' array");
  }

  return {
    tickets: parseTickets(obj.tickets),
    tags: parseTags(obj.tags),
  };
}

export async function importJson(
  db: DB,
  projectId: number,
  json: string
): Promise<{ imported: number }> {
  checkJsonSize(json, "JSON");

  const parsed = safeParseJson(json, "JSON");
  checkDepth(parsed);
  const data = validateImportData(parsed);

  return importProjectData(db, projectId, data.tickets, data.tags);
}
