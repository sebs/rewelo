import { z } from "zod";
import { createRelation, listProjectRelations, listRelations, removeRelation } from "../../relations/repository.js";
import { normalizeRelationType } from "../../relations/types.js";
import { safe } from "../results.js";
import { ADDS, DELETES, READ, resolveTicket, type McpContext } from "../toolkit.js";

export function registerRelationTools(ctx: McpContext): void {
  const { tool, withProject, resolveProject } = ctx;

  tool(
    "relation_create",
    "Create a bidirectional relation between two tickets. Types: blocks, depends-on, relates-to, duplicates, supersedes, precedes, tests, implements, addresses, splits-into, informs, see-also.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      source: z.string().describe("Source ticket title"),
      type: z.string().describe("Relation type (e.g. blocks, depends-on, relates-to)"),
      target: z.string().describe("Target ticket title"),
    },
    ADDS,
    safe(({ project, source, type, target }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const srcTicket = await resolveTicket(db, proj.id, source);
        const tgtTicket = await resolveTicket(db, proj.id, target);
        await createRelation(db, proj.id, srcTicket.id, tgtTicket.id, type);
        return { created: true, source: srcTicket.title, type: normalizeRelationType(type), target: tgtTicket.title };
      })
    )
  );

  tool(
    "relation_remove",
    "Remove a relation between two tickets (removes both directions). Errors if the relation does not exist.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      source: z.string().describe("Source ticket title"),
      type: z.string().describe("Relation type"),
      target: z.string().describe("Target ticket title"),
    },
    DELETES,
    safe(({ project, source, type, target }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const srcTicket = await resolveTicket(db, proj.id, source);
        const tgtTicket = await resolveTicket(db, proj.id, target);
        await removeRelation(db, proj.id, srcTicket.id, tgtTicket.id, type);
        return { removed: true };
      })
    )
  );

  tool(
    "relation_list",
    "List relations for a single ticket. For all relations in a project, use relation_list_all instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      ticket: z.string().describe("Ticket title"),
    },
    READ,
    safe(({ project, ticket }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const t = await resolveTicket(db, proj.id, ticket);
        return listRelations(db, proj.id, t.id);
      })
    )
  );

  tool(
    "relation_list_all",
    "List every relation in a project in one call. Returns source/target IDs, titles, and relation type. Use instead of calling relation_list per ticket.",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => listProjectRelations(db, proj.id)))
  );
}
