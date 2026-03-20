import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { DB } from "../db/connection.js";
import { migrate } from "../db/migrate.js";
import {
  createProject,
  listProjects,
  deleteProject,
  getProjectByName,
  Project,
} from "../projects/repository.js";
import {
  createTicket,
  listTickets,
  getTicketByTitle,
  getTicketById,
  updateTicket,
  upsertTicket,
  deleteTicket,
  Ticket,
} from "../tickets/repository.js";
import { createTag, getTag, listTags, renameTag } from "../tags/repository.js";
import {
  assignTag,
  removeTag,
} from "../tags/assignment.js";
import { listRevisions, listProjectRevisions } from "../revisions/repository.js";
import { priority } from "../calculations/priority.js";
import {
  calculateRelativeWeights,
  Scoreable,
} from "../calculations/relative-weights.js";
import { weightedPriority } from "../calculations/weighted-priority.js";
import { getWeights, setWeights, resetWeights } from "../weights/repository.js";
import { getTicketTimes, averageLeadTime } from "../calculations/time.js";
import { exportCsv } from "../export/csv.js";
import { exportJson } from "../export/json.js";
import { importCsv } from "../import/csv.js";
import { importJson } from "../import/json.js";
import {
  createRelation,
  removeRelation,
  listRelations,
  listProjectRelations,
} from "../relations/repository.js";
import { getProjectSummary } from "../reports/summary.js";
import { getBacklogHealth } from "../reports/health.js";
import { getEventLog } from "../reports/event-log.js";
import { getProjectDiff } from "../reports/diff.js";
import {
  AppError,
  validateProjectName,
  validateTicketTitle,
  validateTicketDescription,
  validateTagPrefix,
  validateTagValue,
} from "../validation/strings.js";
import { validateDbPath } from "../validation/paths.js";
import { sanitizeError } from "../validation/errors.js";
import { VERSION } from "../version.generated.js";
import { loadConfig } from "../config.js";

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text" as const, text: sanitizeError(err) }],
    isError: true,
  };
}

const fibonacciScore = z.union([
  z.literal(1), z.literal(2), z.literal(3),
  z.literal(5), z.literal(8), z.literal(13), z.literal(21),
]);

const MAX_PAYLOAD_BYTES = 1_000_000; // 1 MB per tool call argument

class RateLimiter {
  private timestamps: number[] = [];
  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  check(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) return false;
    this.timestamps.push(now);
    return true;
  }
}

function checkPayloadSize(args: Record<string, unknown>): void {
  const raw = JSON.stringify(args);
  if (raw.length > MAX_PAYLOAD_BYTES) {
    throw new AppError(`Request payload too large (${raw.length} bytes, max ${MAX_PAYLOAD_BYTES})`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(fn: (args: any) => any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (args: any) => {
    try {
      return textResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
}

export function createMcpServer(dbPath: string, options?: { maxRequestsPerSecond?: number }): McpServer {
  const validDbPath = validateDbPath(dbPath);
  const rateLimiter = new RateLimiter(options?.maxRequestsPerSecond ?? 100, 1000);

  const server = new McpServer(
    { name: "rewelo", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: "If a .rewelo.json file exists in the working directory (or any parent), its \"project\" field is used as the default project name. This means the project parameter can be omitted from most tool calls when a .rewelo.json is present.",
    }
  );

  // Shared connection for the lifetime of the server (important for :memory: DBs)
  let sharedDb: DB | null = null;
  let migrated = false;

  async function withDb<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    if (!rateLimiter.check()) {
      throw new AppError("Rate limit exceeded. Try again shortly.");
    }
    if (!sharedDb) {
      sharedDb = await DB.open(validDbPath);
    }
    if (!migrated) {
      await migrate(sharedDb);
      migrated = true;
    }
    return fn(sharedDb);
  }

  const config = loadConfig();

  async function withProject<T>(name: string, fn: (db: DB, project: Project) => Promise<T>): Promise<T> {
    return withDb(async (db) => {
      const proj = await getProjectByName(db, name);
      if (!proj) throw new AppError("Project not found");
      return fn(db, proj);
    });
  }

  function resolveProject(project: string | undefined): string {
    const name = project ?? config.project;
    if (!name) throw new AppError("No project specified and no .rewelo.json config found");
    return name;
  }

  async function resolveTicket(db: DB, projectId: number, title?: string, id?: number): Promise<Ticket> {
    if (!title && id === undefined) throw new AppError("Provide either title or id");
    const ticket = id !== undefined
      ? await getTicketById(db, projectId, id)
      : await getTicketByTitle(db, projectId, title!);
    if (!ticket) throw new AppError(title ? `Ticket "${title}" not found` : `Ticket #${id} not found`);
    return ticket;
  }

  // =========================================================================
  //  VERSION TOOL
  // =========================================================================

  server.tool(
    "server_version",
    "Return the server version string. Use to verify which build is running.",
    {},
    async () => textResult({ version: VERSION })
  );

  // =========================================================================
  //  PROJECT TOOLS
  // =========================================================================

  server.tool(
    "project_create",
    "Create a new project. Name must be unique, alphanumeric with hyphens/underscores.",
    { name: z.string().describe("Project name") },
    safe(async ({ name }) => {
      const validName = validateProjectName(name);
      return withDb((db) => createProject(db, validName));
    })
  );

  server.tool("project_list", "List all projects with their IDs and creation dates.", {},
    safe(() => withDb((db) => listProjects(db)))
  );

  server.tool(
    "project_delete",
    "Delete a project and all its tickets, tags, relations, and history. Irreversible.",
    { name: z.string().describe("Project name") },
    safe(async ({ name }) => ({ deleted: await withDb((db) => deleteProject(db, name)) }))
  );

  // =========================================================================
  //  TICKET TOOLS
  // =========================================================================

  server.tool(
    "ticket_create",
    "Create a new ticket with Fibonacci scores (1,2,3,5,8,13,21). Title must be unique per project. Omitted scores default to 1. Priority = (benefit + penalty) / (estimate + risk). Use ticket_upsert instead if the title may already exist.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title (max 500 chars)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit if delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty if not delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Implementation effort (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Implementation risk/uncertainty (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    safe(async ({ project, title, description, benefit, penalty, estimate, risk }) => {
      const validTitle = validateTicketTitle(title);
      const validDesc = validateTicketDescription(description);
      return withProject(resolveProject(project), (db, proj) =>
        createTicket(db, { projectId: proj.id, title: validTitle, description: validDesc, benefit, penalty, estimate, risk })
      );
    })
  );

  server.tool(
    "ticket_list",
    "List tickets with calculated value, cost, and priority. Supports tag filters (intersection), exclude-tags, title search, score thresholds, sort, and limit/offset pagination. Returns {total, offset, items[]}.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      tag: z.string().optional().describe("Filter by tag (prefix:value) — single tag, kept for backward compat"),
      tags: z.array(z.string()).optional().describe("Filter by multiple tags (intersection). Each as prefix:value"),
      excludeTags: z.array(z.string()).optional().describe("Exclude tickets with these tags. Each as prefix:value"),
      search: z.string().optional().describe("Filter by title substring (case-insensitive)"),
      sort: z.string().optional().describe("Sort descending by: priority, benefit, penalty, estimate, risk, value, cost"),
      limit: z.number().optional().describe("Max number of results to return"),
      offset: z.number().optional().describe("Skip first N results (for pagination)"),
      minPriority: z.number().optional().describe("Minimum priority threshold"),
      minValue: z.number().optional().describe("Minimum value (benefit+penalty) threshold"),
      maxCost: z.number().optional().describe("Maximum cost (estimate+risk) threshold"),
    },
    safe(({ project, tag, tags: tagFilters, excludeTags, search, sort, limit, offset, minPriority, minValue, maxCost }) =>
      withProject(resolveProject(project), async (db, proj) => {
        // Build tag filter arrays
        const includeTags: { prefix: string; value: string }[] = [];
        if (tag) { const [p, v] = tag.split(":"); includeTags.push({ prefix: p, value: v }); }
        if (tagFilters) for (const ts of tagFilters) { const [p, v] = ts.split(":"); includeTags.push({ prefix: p, value: v }); }

        const excludeTagPairs: { prefix: string; value: string }[] = [];
        if (excludeTags) for (const ts of excludeTags) { const [p, v] = ts.split(":"); excludeTagPairs.push({ prefix: p, value: v }); }

        const tickets = await listTickets(db, proj.id, {
          includeTags: includeTags.length > 0 ? includeTags : undefined,
          excludeTags: excludeTagPairs.length > 0 ? excludeTagPairs : undefined,
          search,
        });

        const enriched = tickets.map((t) => ({
          ...t,
          value: t.benefit + t.penalty,
          cost: t.estimate + t.risk,
          priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
        }));

        // Score threshold filters
        let filtered = enriched;
        if (minPriority != null) filtered = filtered.filter((t) => t.priority >= minPriority);
        if (minValue != null) filtered = filtered.filter((t) => t.value >= minValue);
        if (maxCost != null) filtered = filtered.filter((t) => t.cost <= maxCost);

        if (sort) {
          const validSortFields = ["priority", "benefit", "penalty", "estimate", "risk", "value", "cost"];
          if (!validSortFields.includes(sort)) {
            throw new AppError(`Invalid sort field "${sort}". Valid fields: ${validSortFields.join(", ")}`);
          }
          const key = sort as keyof (typeof filtered)[0];
          filtered.sort((a, b) => (b[key] as number) - (a[key] as number));
        }

        // Pagination
        const total = filtered.length;
        const off = Math.max(0, offset ?? 0);
        let page = filtered.slice(off);
        if (limit != null) {
          if (limit < 0) throw new AppError("limit must be a non-negative number");
          page = page.slice(0, limit);
        }

        return { total, offset: off, items: page };
      })
    )
  );

  server.tool(
    "ticket_update",
    "Update a ticket's title, description, or scores. Only provided fields are changed. Identified by current title.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Current ticket title"),
      newTitle: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      benefit: fibonacciScore.optional().describe("Benefit score"),
      penalty: fibonacciScore.optional().describe("Penalty score"),
      estimate: fibonacciScore.optional().describe("Estimate score"),
      risk: fibonacciScore.optional().describe("Risk score"),
    },
    safe(async ({ project, title, newTitle, description, benefit, penalty, estimate, risk }) => {
      const validNewTitle = newTitle ? validateTicketTitle(newTitle) : undefined;
      const validDesc = validateTicketDescription(description);
      return withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title);
        return updateTicket(db, proj.id, ticket.id, {
          title: validNewTitle, description: validDesc, benefit, penalty, estimate, risk,
        });
      });
    })
  );

  server.tool(
    "ticket_upsert",
    "Create or update a ticket matched by exact title. Returns {ticket, action: 'created'|'updated'}. Idempotent — safe to call repeatedly without duplicate errors.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title (used as the unique key)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit score (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty score (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Estimate score (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Risk score (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    safe(async ({ project, title, description, benefit, penalty, estimate, risk }) => {
      const validTitle = validateTicketTitle(title);
      const validDesc = validateTicketDescription(description);
      return withProject(resolveProject(project), async (db, proj) => {
        return upsertTicket(db, proj.id, validTitle, {
          description: validDesc, benefit, penalty, estimate, risk,
        });
      });
    })
  );

  server.tool(
    "ticket_delete",
    "Delete a ticket and its relations, revisions, and tag assignments. Irreversible.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title"),
    },
    safe(({ project, title }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title);
        return { deleted: await deleteTicket(db, proj.id, ticket.id) };
      })
    )
  );

  server.tool(
    "ticket_history",
    "Show revision history for a single ticket. Provide title or id. For project-wide history, use project_history instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().optional().describe("Ticket title (provide title or id)"),
      id: z.number().optional().describe("Ticket numeric ID (provide title or id)"),
    },
    safe(({ project, title, id }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title, id);
        return listRevisions(db, ticket.id);
      })
    )
  );

  server.tool(
    "project_history",
    "List revision history across all tickets in a project, newest first. Use instead of calling ticket_history per ticket. Supports since/limit filters.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().optional().describe("Only show revisions after this ISO timestamp"),
      limit: z.number().optional().describe("Maximum number of revisions to return"),
    },
    safe(({ project, since, limit }) =>
      withProject(resolveProject(project), (db, proj) => listProjectRevisions(db, proj.id, since, limit))
    )
  );

  // =========================================================================
  //  TAG TOOLS
  // =========================================================================

  server.tool(
    "tag_create",
    "Create a tag (prefix:value). Required before using tag_assign. Prefix and value must be lowercase alphanumeric/hyphens. Must be unique per project.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    safe(async ({ project, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return withProject(resolveProject(project), (db, proj) => createTag(db, proj.id, validPrefix, validValue));
    })
  );

  server.tool(
    "tag_assign",
    "Assign existing tags to tickets. Prerequisite: create tags first with tag_create. Supports batch: single or multiple tags × single or multiple tickets in one call.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      ticket: z.string().optional().describe("Ticket title (single)"),
      tickets: z.array(z.string()).optional().describe("Ticket titles (multiple)"),
      prefix: z.string().optional().describe("Tag prefix (single tag)"),
      value: z.string().optional().describe("Tag value (single tag)"),
      tags: z.array(z.object({ prefix: z.string(), value: z.string() })).optional().describe("Multiple tags to assign"),
    },
    safe(async ({ project, ticket: ticketTitle, tickets: ticketTitles, prefix, value, tags: tagList }) => {
      const allTickets: string[] = [];
      if (ticketTitle) allTickets.push(ticketTitle);
      if (ticketTitles) allTickets.push(...ticketTitles);
      if (allTickets.length === 0) throw new AppError("Provide ticket or tickets");

      const allTags: { prefix: string; value: string }[] = [];
      if (prefix && value) allTags.push({ prefix, value });
      if (tagList) allTags.push(...tagList);
      if (allTags.length === 0) throw new AppError("Provide prefix+value or tags");

      const validatedTags = allTags.map(t => ({
        prefix: validateTagPrefix(t.prefix),
        value: validateTagValue(t.value),
      }));

      return withProject(resolveProject(project), async (db, proj) => {
        const out: { ticket: string; tag: string; status: "assigned" | "already_assigned" }[] = [];
        for (const title of allTickets) {
          const ticket = await resolveTicket(db, proj.id, title);
          for (const t of validatedTags) {
            const tag = await getTag(db, proj.id, t.prefix, t.value);
            if (!tag) throw new AppError(`Tag "${t.prefix}:${t.value}" not found. Create it first with tag_create.`);
            const newlyAssigned = await assignTag(db, ticket.id, tag.id);
            out.push({ ticket: title, tag: `${t.prefix}:${t.value}`, status: newlyAssigned ? "assigned" : "already_assigned" });
          }
        }
        return out;
      });
    })
  );

  server.tool(
    "tag_remove",
    "Remove a tag assignment from a ticket. The tag itself is not deleted.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      ticket: z.string().describe("Ticket title"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    safe(async ({ project, ticket: ticketTitle, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, ticketTitle);
        const tag = await getTag(db, proj.id, validPrefix, validValue);
        if (!tag) throw new AppError("Tag not found");
        const wasRemoved = await removeTag(db, ticket.id, tag.id);
        return { ticket: ticketTitle, tag: `${validPrefix}:${validValue}`, status: wasRemoved ? "removed" : "was_not_assigned" };
      });
    })
  );

  server.tool(
    "tag_list",
    "List all tags defined in a project, sorted by prefix then value.",
    { project: z.string().describe("Project name") },
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => listTags(db, proj.id)))
  );

  server.tool(
    "tag_rename",
    "Rename a tag's value. All ticket assignments carry over. New value must not conflict with an existing tag under the same prefix.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix"),
      oldValue: z.string().describe("Current tag value"),
      newValue: z.string().describe("New tag value"),
    },
    safe(async ({ project, prefix, oldValue, newValue }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validOldValue = validateTagValue(oldValue);
      const validNewValue = validateTagValue(newValue);
      return withProject(resolveProject(project), async (db, proj) => {
        const tag = await getTag(db, proj.id, validPrefix, validOldValue);
        if (!tag) throw new AppError("Tag not found");
        return renameTag(db, proj.id, tag.id, validPrefix, validNewValue);
      });
    })
  );

  // =========================================================================
  //  WEIGHT CONFIGURATION TOOLS
  // =========================================================================

  server.tool(
    "weight_get",
    "Get the weight configuration (w1-w4) for a project. Defaults are all 1.5 if not customized.",
    { project: z.string().describe("Project name") },
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => getWeights(db, proj.id)))
  );

  server.tool(
    "weight_set",
    "Set weight configuration (w1-w4) for a project. Range: 0-100. Only provided weights change; omitted ones keep their current value.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      w1: z.number().optional().describe("Benefit weight"),
      w2: z.number().optional().describe("Penalty weight"),
      w3: z.number().optional().describe("Estimate weight"),
      w4: z.number().optional().describe("Risk weight"),
    },
    safe(({ project, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const current = await getWeights(db, proj.id);
        return setWeights(db, proj.id, uw1 ?? current.w1, uw2 ?? current.w2, uw3 ?? current.w3, uw4 ?? current.w4);
      })
    )
  );

  server.tool(
    "weight_reset",
    "Reset weight configuration to defaults (all 1.5).",
    { project: z.string().describe("Project name") },
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => resetWeights(db, proj.id)))
  );

  // =========================================================================
  //  CALCULATION TOOLS
  // =========================================================================

  server.tool(
    "calc_priority",
    "Calculate weighted priorities for all tickets, sorted descending. Inline w1-w4 override stored weights for this call only. Returns {title, priority, weighted} per ticket. For de-risk-first ordering, use ticket_list with sort='risk' instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      w1: z.number().optional().describe("Benefit weight (default 1.5). Higher = benefit matters more in value."),
      w2: z.number().optional().describe("Penalty weight (default 1.5). Higher = penalty matters more in value."),
      w3: z.number().optional().describe("Estimate weight (default 1.5). Higher = large estimates are penalised more."),
      w4: z.number().optional().describe("Risk weight (default 1.5). Higher = risky items are penalised more. To de-risk first, sort by risk via ticket_list instead."),
    },
    safe(({ project, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id);
        const config = await getWeights(db, proj.id);
        const w1 = uw1 ?? config.w1;
        const w2 = uw2 ?? config.w2;
        const w3 = uw3 ?? config.w3;
        const w4 = uw4 ?? config.w4;

        return tickets
          .map((t) => ({
            title: t.title,
            priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
            weighted: weightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4),
          }))
          .sort((a, b) => b.weighted - a.weighted);
      })
    )
  );

  server.tool(
    "calc_weights",
    "Calculate each ticket's relative share of total value and cost as percentages. Shows how one ticket compares to the whole backlog.",
    { project: z.string().describe("Project name") },
    safe(({ project }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id);
        const scoreables: Scoreable[] = tickets;
        return tickets.map((t) => ({ title: t.title, ...calculateRelativeWeights(t, scoreables) }));
      })
    )
  );

  // =========================================================================
  //  REPORT TOOLS
  // =========================================================================

  server.tool(
    "report_summary",
    "Get project overview: total tickets, breakdown by state tag, and top-N by priority. Good starting point for any project.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      topN: z.number().optional().describe("Number of top tickets"),
    },
    safe(({ project, topN }) =>
      withProject(resolveProject(project), (db, proj) => getProjectSummary(db, proj.id, topN ?? 5))
    )
  );

  server.tool(
    "report_times",
    "Calculate lead time (created→done) and cycle time (wip→done) per ticket, plus averages. Prerequisite: assign state:wip and state:done tags to tickets.",
    { project: z.string().describe("Project name") },
    safe(({ project }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id);
        const times = await Promise.all(tickets.map((t) => getTicketTimes(db, t.id)));
        return { tickets: times, averageLeadTimeDays: averageLeadTime(times) };
      })
    )
  );

  server.tool(
    "report_health",
    "Assess backlog health: high/low priority ratio, open ticket count, total cost. highToLowRatio is null when all tickets are high priority.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      threshold: z.number().optional().describe("High priority threshold"),
    },
    safe(({ project, threshold }) =>
      withProject(resolveProject(project), (db, proj) => getBacklogHealth(db, proj.id, threshold ?? 1.5))
    )
  );

  // =========================================================================
  //  EVENT LOG & DIFF TOOLS
  // =========================================================================

  server.tool(
    "event_log",
    "Get a unified event stream combining ticket creates, updates, and tag changes. Newest first. Use 'since' to poll incrementally.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().optional().describe("Only events after this ISO timestamp"),
      limit: z.number().optional().describe("Maximum number of events to return"),
    },
    safe(({ project, since, limit }) =>
      withProject(resolveProject(project), (db, proj) => getEventLog(db, proj.id, since, limit ?? 50))
    )
  );

  server.tool(
    "project_diff",
    "Compare project state against a point in time. Returns new tickets, score/title changes, and tag changes since the timestamp.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().describe("ISO timestamp to diff from (e.g. '2026-03-10T00:00:00Z')"),
    },
    safe(({ project, since }) =>
      withProject(resolveProject(project), (db, proj) => getProjectDiff(db, proj.id, since))
    )
  );

  // =========================================================================
  //  EXPORT / IMPORT TOOLS
  // =========================================================================

  server.tool(
    "export_csv",
    "Export all tickets as CSV. Optionally includes calculated value, cost, and priority columns.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      withCalculations: z.boolean().optional().describe("Include value/cost/priority columns"),
    },
    safe(({ project, withCalculations }) =>
      withProject(resolveProject(project), (db, proj) => exportCsv(db, proj.id, { withCalculations }))
    )
  );

  server.tool(
    "export_json",
    "Export project tickets, tags, and optionally revision history as JSON. Use for backups of a single project.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      withHistory: z.boolean().optional().describe("Include revisions and audit log"),
    },
    safe(({ project, withHistory }) =>
      withProject(resolveProject(project), (db, proj) => exportJson(db, proj.id, { withHistory }))
    )
  );

  server.tool(
    "import_csv",
    "Import tickets from CSV string. Only 'title' column is required; missing score columns default to 1. Tags column optional (comma-separated prefix:value).",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      csv: z.string().describe("CSV content"),
    },
    safe(async ({ project, csv }) => {
      checkPayloadSize({ csv });
      return withProject(resolveProject(project), (db, proj) => importCsv(db, proj.id, csv));
    })
  );

  server.tool(
    "import_json",
    "Import tickets and tags from a JSON object with a 'tickets' array. Tags are auto-created during import.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      json: z.string().describe("JSON content"),
    },
    safe(async ({ project, json }) => {
      checkPayloadSize({ json });
      return withProject(resolveProject(project), (db, proj) => importJson(db, proj.id, json));
    })
  );

  // =========================================================================
  //  RELATIONS
  // =========================================================================

  server.tool(
    "relation_create",
    "Create a bidirectional relation between two tickets. Types: blocks, depends-on, relates-to, duplicates, supersedes, precedes, tests, implements, addresses, splits-into, informs, see-also.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      source: z.string().describe("Source ticket title"),
      type: z.string().describe("Relation type (e.g. blocks, depends-on, relates-to)"),
      target: z.string().describe("Target ticket title"),
    },
    safe(({ project, source, type, target }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const srcTicket = await resolveTicket(db, proj.id, source);
        const tgtTicket = await resolveTicket(db, proj.id, target);
        await createRelation(db, proj.id, srcTicket.id, tgtTicket.id, type);
        return { created: true, source, type, target };
      })
    )
  );

  server.tool(
    "relation_remove",
    "Remove a relation between two tickets (removes both directions). Errors if the relation does not exist.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      source: z.string().describe("Source ticket title"),
      type: z.string().describe("Relation type"),
      target: z.string().describe("Target ticket title"),
    },
    safe(({ project, source, type, target }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const srcTicket = await resolveTicket(db, proj.id, source);
        const tgtTicket = await resolveTicket(db, proj.id, target);
        await removeRelation(db, proj.id, srcTicket.id, tgtTicket.id, type);
        return { removed: true };
      })
    )
  );

  server.tool(
    "relation_list",
    "List relations for a single ticket. For all relations in a project, use relation_list_all instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      ticket: z.string().describe("Ticket title"),
    },
    safe(({ project, ticket }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const t = await resolveTicket(db, proj.id, ticket);
        return listRelations(db, proj.id, t.id);
      })
    )
  );

  server.tool(
    "relation_list_all",
    "List every relation in a project in one call. Returns source/target IDs, titles, and relation type. Use instead of calling relation_list per ticket.",
    { project: z.string().describe("Project name") },
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => listProjectRelations(db, proj.id)))
  );


  return server;
}

export async function startMcpServer(dbPath: string): Promise<void> {
  const server = createMcpServer(dbPath);
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
}
