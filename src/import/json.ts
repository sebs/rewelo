import { DB } from "../db/connection.js";
import { ValidationError } from "../errors.js";
import { validateProjectName } from "../validation/strings.js";
import { createProject, getProjectByName } from "../projects/repository.js";
import { importProjectData } from "../serialization/import-project.js";
import { checkDepth, checkJsonSize, safeParseJson, parseTickets, parseTags, parseRelations, parseWeights } from "../serialization/parse.js";
import type { ImportableTicket } from "../serialization/import-project.js";
import type { SerializedRelation, SerializedWeights, TagPair } from "../serialization/export-project.js";

interface ImportData {
  tickets: ImportableTicket[];
  tags?: TagPair[];
  relations?: SerializedRelation[];
  weights?: SerializedWeights;
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
    relations: parseRelations(obj.relations),
    weights: parseWeights(obj.weights),
  };
}

export async function importJson(
  db: DB,
  projectId: number,
  json: string
): Promise<Awaited<ReturnType<typeof importProjectData>>> {
  checkJsonSize(json, "JSON");

  const parsed = safeParseJson(json, "JSON");
  checkDepth(parsed);
  const data = validateImportData(parsed);

  return importProjectData(db, projectId, data.tickets, data.tags, {
    relations: data.relations,
    weights: data.weights,
  });
}

// Import into the named project, creating it first if it does not exist.
// Creation and import share one transaction, so a failed import does not
// leave an empty new project behind.
export async function importJsonAsProject(
  db: DB,
  projectName: string,
  json: string
): Promise<Awaited<ReturnType<typeof importJson>> & { projectCreated: boolean }> {
  return db.transaction(async () => {
    const existing = await getProjectByName(db, projectName);
    const project = existing ?? (await createProject(db, validateProjectName(projectName)));
    const result = await importJson(db, project.id, json);
    return { ...result, projectCreated: !existing };
  });
}
