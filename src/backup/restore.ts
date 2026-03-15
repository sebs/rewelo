import { DB } from "../db/connection.js";
import { createProject, getProjectByName } from "../projects/repository.js";
import { setWeights } from "../weights/repository.js";
import { ValidationError } from "../validation/strings.js";
import { importProjectData } from "../serialization/import-project.js";
import { checkDepth, checkJsonSize, safeParseJson, parseTickets, parseTags } from "../serialization/parse.js";
import type { BackupData, BackupProject } from "./backup.js";

const SUPPORTED_SCHEMA_VERSIONS = [1];

function validateBackupData(data: unknown): BackupData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("Backup JSON must be an object");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "number") {
    throw new ValidationError("Backup file missing schemaVersion");
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(obj.schemaVersion)) {
    throw new ValidationError(
      `Incompatible schema version ${obj.schemaVersion}. Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`
    );
  }

  if (!Array.isArray(obj.projects)) {
    throw new ValidationError("Backup file must contain a 'projects' array");
  }

  const projects: BackupProject[] = [];
  for (let p = 0; p < obj.projects.length; p++) {
    const proj = obj.projects[p] as Record<string, unknown>;
    if (!proj || typeof proj !== "object") {
      throw new ValidationError(`Project ${p + 1}: must be an object`);
    }
    if (typeof proj.name !== "string" || proj.name.length === 0) {
      throw new ValidationError(`Project ${p + 1}: name is required`);
    }
    if (!Array.isArray(proj.tickets)) {
      throw new ValidationError(`Project "${proj.name}": tickets must be an array`);
    }

    const errorPrefix = `Project "${proj.name}", ticket`;
    const tickets = parseTickets(proj.tickets, errorPrefix);

    // parseTickets returns description as undefined for missing values;
    // normalise to null to match BackupProject's SerializedTicket shape
    const normalisedTickets = tickets.map((t) => ({
      ...t,
      description: t.description ?? null,
      tags: t.tags ?? [],
    }));

    const tags = parseTags(proj.tags) ?? [];

    let weights = null;
    if (proj.weights && typeof proj.weights === "object" && !Array.isArray(proj.weights)) {
      const w = proj.weights as Record<string, unknown>;
      weights = {
        w1: Number(w.w1),
        w2: Number(w.w2),
        w3: Number(w.w3),
        w4: Number(w.w4),
      };
    }

    projects.push({
      name: proj.name as string,
      tickets: normalisedTickets,
      tags,
      weights,
    });
  }

  return {
    schemaVersion: obj.schemaVersion as 1,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
    appVersion: typeof obj.appVersion === "string" ? obj.appVersion : "unknown",
    projects,
  };
}

export interface RestoreResult {
  projects: number;
  tickets: number;
  tags: number;
}

export async function restore(db: DB, json: string): Promise<RestoreResult> {
  checkJsonSize(json, "Backup file");

  const parsed = safeParseJson(json, "JSON in backup file");
  checkDepth(parsed);
  const data = validateBackupData(parsed);

  let totalTickets = 0;
  let totalTags = 0;

  for (const proj of data.projects) {
    const existing = await getProjectByName(db, proj.name);
    if (existing) {
      throw new ValidationError(`Project "${proj.name}" already exists. Delete it first or use a fresh database.`);
    }

    const project = await createProject(db, proj.name);

    const result = await importProjectData(db, project.id, proj.tickets, proj.tags);
    totalTickets += result.imported;
    totalTags += result.tagsCreated;

    if (proj.weights) {
      await setWeights(db, project.id, proj.weights.w1, proj.weights.w2, proj.weights.w3, proj.weights.w4);
    }
  }

  return {
    projects: data.projects.length,
    tickets: totalTickets,
    tags: totalTags,
  };
}
