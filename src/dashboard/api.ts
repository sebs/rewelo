import { DB } from "../db/connection.js";
import { listProjects, getProjectByName } from "../projects/repository.js";
import { listTickets } from "../tickets/repository.js";
import { listTags } from "../tags/repository.js";
import { weightedPriority } from "../calculations/weighted-priority.js";
import { getWeights } from "../weights/repository.js";

interface Tag { id: number; project_id: number; prefix: string; value: string; }
import { buildCFD } from "./cfd.js";

export async function apiRoutes(db: DB, url: URL): Promise<unknown> {
  const path = url.pathname;

  // GET /api/projects
  if (path === "/api/projects") {
    return listProjects(db);
  }

  // GET /api/projects/:name/kanban?sprint=sprint:1
  const kanbanMatch = path.match(/^\/api\/projects\/([^/]+)\/kanban$/);
  if (kanbanMatch) {
    const name = decodeURIComponent(kanbanMatch[1]);
    const project = await getProjectByName(db, name);
    if (!project) throw new Error("Project not found");

    const sprint = url.searchParams.get("sprint") ?? undefined;

    // Get all tickets
    let tickets = await listTickets(db, project.id);

    // Get all tags for the project to resolve tag assignments
    const allTags = await listTags(db, project.id);
    const tagMap = new Map(allTags.map((t) => [t.id, t]));

    // Get ticket tags
    const ticketTags = new Map<number, Array<{ prefix: string; value: string }>>();
    for (const ticket of tickets) {
      const tags = await db.all<{ tag_id: number }>(
        `SELECT tag_id FROM rw.ticket_tags WHERE ticket_id = ?`,
        ticket.id
      );
      ticketTags.set(
        ticket.id,
        tags.map((t) => {
          const tag = tagMap.get(t.tag_id);
          return tag ? { prefix: tag.prefix, value: tag.value } : { prefix: "unknown", value: "unknown" };
        })
      );
    }

    // Filter by sprint if specified
    if (sprint) {
      const parts = sprint.split(":");
      const prefix = parts[0];
      const value = parts.slice(1).join(":");
      tickets = tickets.filter((t) => {
        const tags = ticketTags.get(t.id) ?? [];
        return tags.some((tg) => tg.prefix === prefix && tg.value === value);
      });
    }

    // Get weighted priorities
    const weights = await getWeights(db, project.id);
    const priorityMap = new Map<number, number>();
    for (const t of tickets) {
      const p = weightedPriority(t.benefit, t.penalty, t.estimate, t.risk, weights.w1, weights.w2, weights.w3, weights.w4);
      priorityMap.set(t.id, p);
    }

    // Group tickets by state
    const columns: Record<string, Array<Record<string, unknown>>> = {
      backlog: [],
      wip: [],
      done: [],
    };

    for (const ticket of tickets) {
      const tags = ticketTags.get(ticket.id) ?? [];
      const stateTag = tags.find((t) => t.prefix === "state");
      const state = stateTag?.value ?? "backlog";
      const col = columns[state] ?? columns.backlog;

      col.push({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        benefit: ticket.benefit,
        penalty: ticket.penalty,
        estimate: ticket.estimate,
        risk: ticket.risk,
        priority: priorityMap.get(ticket.id) ?? 0,
        tags: tags.filter((t) => t.prefix !== "state"),
      });
    }

    // Sort each column by priority descending
    for (const col of Object.values(columns)) {
      col.sort((a, b) => (b.priority as number) - (a.priority as number));
    }

    return { columns };
  }

  // GET /api/projects/:name/cfd?sprint=sprint:1
  const cfdMatch = path.match(/^\/api\/projects\/([^/]+)\/cfd$/);
  if (cfdMatch) {
    const name = decodeURIComponent(cfdMatch[1]);
    const project = await getProjectByName(db, name);
    if (!project) throw new Error("Project not found");

    const sprint = url.searchParams.get("sprint") ?? undefined;
    return buildCFD(db, project.id, sprint);
  }

  // GET /api/projects/:name/sprints (list sprint tags)
  const sprintsMatch = path.match(/^\/api\/projects\/([^/]+)\/sprints$/);
  if (sprintsMatch) {
    const name = decodeURIComponent(sprintsMatch[1]);
    const project = await getProjectByName(db, name);
    if (!project) throw new Error("Project not found");

    const tags = await listTags(db, project.id);
    return tags
      .filter((t) => t.prefix === "sprint")
      .map((t) => `sprint:${t.value}`);
  }

  throw new Error("Not found: " + path);
}
