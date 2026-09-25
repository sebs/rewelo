import { DB } from "../../db/connection.js";
import { prefixValidationErrors, ValidationError } from "../../errors.js";
import { createProject, getProjectByName } from "../../projects/repository.js";
import { createRelation, relationExists } from "../../relations/repository.js";
import { assignTag } from "../../tags/assignment.js";
import { ensureTag } from "../../tags/repository.js";
import { createTicket, getTicketByTitle } from "../../tickets/repository.js";
import { deletionRows, parseDeletions, PendingHistoryRow, prepareHistory, writeHistory } from "./history.js";
import { parseRelations, parseTickets, parseWeights } from "./parse.js";
import { checkDepth, checkJsonSize, checkKeys, parseTags, safeParseJson } from "./values.js";
import type { ImportableTicket, SerializedRelation, SerializedWeights, TagPair, SerializedDeletion } from "../types.js";
import { validateProjectName } from "../../validation/strings.js";
import { setWeights } from "../../weights/repository.js";

export async function importProjectData(
  db: DB,
  projectId: number,
  tickets: ImportableTicket[],
  projectTags?: TagPair[],
  extras: { relations?: SerializedRelation[]; weights?: SerializedWeights; deletions?: SerializedDeletion[] } = {}
): Promise<{ imported: number; tagsCreated: number; relationsCreated: number; weights?: SerializedWeights }> {
  return db.transaction(async () => {
    let tagsCreated = 0;
    let relationsCreated = 0;

    // Pre-create any project-level tags
    if (projectTags) {
      for (const tagDef of projectTags) {
        if ((await ensureTag(db, projectId, tagDef.prefix, tagDef.value)).created) tagsCreated++;
      }
    }

    // History rows of all tickets, written after the tickets in their original
    // order: the event log breaks timestamp ties by write order
    const history: PendingHistoryRow[] = [];
    const firstTicket = new Map<string, number>();
    for (const [i, t] of tickets.entries()) {
      // Titles are normalised by now, so "café" (NFC/NFD) or "a  b" repeat here
      const earlier = firstTicket.get(t.title);
      if (earlier !== undefined) {
        throw new ValidationError(`Ticket ${i + 1}: title "${t.title}" is the same as ticket ${earlier + 1}'s`);
      }
      firstTicket.set(t.title, i);
      // e.g. a title already taken, in the project or earlier in the file
      const ticket = await prefixValidationErrors(`Ticket ${i + 1}`, () =>
        createTicket(db, {
          projectId,
          title: t.title,
          description: t.description ?? undefined,
          benefit: t.benefit,
          penalty: t.penalty,
          estimate: t.estimate,
          risk: t.risk,
        })
      );

      if (t.tags) {
        for (const tagDef of t.tags) {
          const { tag, created } = await ensureTag(db, projectId, tagDef.prefix, tagDef.value);
          if (created) tagsCreated++;
          await assignTag(db, ticket.id, tag.id);
        }
      }

      if (t.history) history.push(...(await prepareHistory(db, ticket.id, t.history)));
    }
    history.push(...deletionRows(extras.deletions ?? []));
    tagsCreated += await writeHistory(db, projectId, history);

    for (const [i, r] of (extras.relations ?? []).entries()) {
      const source = await getTicketByTitle(db, projectId, r.source);
      const target = await getTicketByTitle(db, projectId, r.target);
      if (!source || !target) {
        throw new ValidationError(`Relation ${i + 1}: ticket "${source ? r.target : r.source}" not found`);
      }
      // A relation the project has already is kept, not an error
      const exists = await relationExists(db, projectId, source.id, target.id, r.type);
      if (!exists) {
        // e.g. a self-relation, or one contradicting an earlier relation
        await prefixValidationErrors(`Relation ${i + 1}`, () => createRelation(db, projectId, source.id, target.id, r.type));
        relationsCreated++;
      }
    }

    if (extras.weights) {
      await setWeights(db, projectId, extras.weights);
    }

    // Say what else changed: the file's weights replace the project's, and
    // neither that nor the relations showed in the result
    return {
      imported: tickets.length,
      tagsCreated,
      relationsCreated,
      ...(extras.weights ? { weights: extras.weights } : {}),
    };
  });
}

export interface ImportData {
  tickets: ImportableTicket[];
  tags?: TagPair[];
  relations?: SerializedRelation[];
  weights?: SerializedWeights;
  deletions?: SerializedDeletion[];
}

function validateImportData(data: unknown): ImportData {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("JSON must be an object with a 'tickets' array");
  }

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.tickets)) {
    throw new ValidationError("JSON must contain a 'tickets' array");
  }
  checkKeys(obj, ["tickets", "tags", "relations", "weights", "deletions"], "JSON");

  return {
    tickets: parseTickets(obj.tickets),
    tags: parseTags(obj.tags),
    relations: parseRelations(obj.relations),
    weights: parseWeights(obj.weights),
    deletions: parseDeletions(obj.deletions),
  };
}

/** A JSON import's content, read and checked without a database */
export function parseImportJson(json: string): ImportData {
  checkJsonSize(json, "JSON");
  const parsed = safeParseJson(json, "JSON");
  checkDepth(parsed);
  return validateImportData(parsed);
}

export async function importJson(
  db: DB,
  projectId: number,
  json: string
): Promise<Awaited<ReturnType<typeof importProjectData>>> {
  return importData(db, projectId, parseImportJson(json));
}

function importData(db: DB, projectId: number, data: ImportData) {
  return importProjectData(db, projectId, data.tickets, data.tags, {
    relations: data.relations,
    weights: data.weights,
    deletions: data.deletions,
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
  return importDataAsProject(db, projectName, parseImportJson(json));
}

/** importJsonAsProject for content parseImportJson has read */
export async function importDataAsProject(
  db: DB,
  projectName: string,
  data: ImportData
): Promise<Awaited<ReturnType<typeof importJson>> & { projectCreated: boolean }> {
  return db.transaction(async () => {
    const existing = await getProjectByName(db, projectName);
    const project = existing ?? (await createProject(db, validateProjectName(projectName)));
    const result = await importData(db, project.id, data);
    return { ...result, projectCreated: !existing };
  });
}
