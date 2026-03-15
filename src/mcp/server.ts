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
} from "../projects/repository.js";
import {
  createTicket,
  listTickets,
  getTicketByTitle,
  getTicketById,
  updateTicket,
  upsertTicket,
  deleteTicket,
} from "../tickets/repository.js";
import { createTag, getTag, listTags, renameTag } from "../tags/repository.js";
import {
  assignTag,
  removeTag,
  listTicketsByTag,
} from "../tags/assignment.js";
import { createRevision, listRevisions, listProjectRevisions } from "../revisions/repository.js";
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
import { backup } from "../backup/backup.js";
import { restore } from "../backup/restore.js";
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
  validateProjectName,
  validateTicketTitle,
  validateTicketDescription,
  validateTagPrefix,
  validateTagValue,
} from "../validation/strings.js";
import { validateDbPath } from "../validation/paths.js";
import { sanitizeError } from "../validation/errors.js";
import { VERSION } from "../version.generated.js";

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
    throw new Error(`Request payload too large (${raw.length} bytes, max ${MAX_PAYLOAD_BYTES})`);
  }
}

export function createMcpServer(dbPath: string, options?: { maxRequestsPerSecond?: number }): McpServer {
  const validDbPath = validateDbPath(dbPath);
  const rateLimiter = new RateLimiter(options?.maxRequestsPerSecond ?? 100, 1000);

  const server = new McpServer(
    { name: "rewelo", version: VERSION },
    { capabilities: { tools: {} } }
  );

  // Shared connection for the lifetime of the server (important for :memory: DBs)
  let sharedDb: DB | null = null;
  let migrated = false;

  async function withDb<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    if (!rateLimiter.check()) {
      throw new Error("Rate limit exceeded. Try again shortly.");
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

  // =========================================================================
  //  VERSION TOOL
  // =========================================================================

  server.tool(
    "server_version",
    "Return the server version string. Use to verify which build is running.",
    {},
    async () => {
      return textResult({ version: VERSION });
    }
  );

  // =========================================================================
  //  PROJECT TOOLS
  // =========================================================================

  server.tool(
    "project_create",
    "Create a new project. Name must be unique, alphanumeric with hyphens/underscores.",
    { name: z.string().describe("Project name") },
    async ({ name }) => {
      try {
        const validName = validateProjectName(name);
        const result = await withDb((db) => createProject(db, validName));
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool("project_list", "List all projects with their IDs and creation dates.", {}, async () => {
    try {
      const result = await withDb((db) => listProjects(db));
      return textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  });

  server.tool(
    "project_delete",
    "Delete a project and all its tickets, tags, relations, and history. Irreversible.",
    { name: z.string().describe("Project name") },
    async ({ name }) => {
      try {
        const deleted = await withDb((db) => deleteProject(db, name));
        return textResult({ deleted });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  TICKET TOOLS
  // =========================================================================

  server.tool(
    "ticket_create",
    "Create a new ticket with Fibonacci scores (1,2,3,5,8,13,21). Title must be unique per project. Omitted scores default to 1. Priority = (benefit + penalty) / (estimate + risk). Use ticket_upsert instead if the title may already exist.",
    {
      project: z.string().describe("Project name"),
      title: z.string().describe("Ticket title (max 500 chars)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit if delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty if not delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Implementation effort (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Implementation risk/uncertainty (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    async ({ project, title, description, benefit, penalty, estimate, risk }) => {
      try {
        const validTitle = validateTicketTitle(title);
        const validDesc = validateTicketDescription(description);
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return createTicket(db, {
            projectId: proj.id,
            title: validTitle,
            description: validDesc,
            benefit,
            penalty,
            estimate,
            risk,
          });
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "ticket_list",
    "List tickets with calculated value, cost, and priority. Supports tag filters (intersection), exclude-tags, title search, score thresholds, sort, and limit/offset pagination. Returns {total, offset, items[]}.",
    {
      project: z.string().describe("Project name"),
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
    async ({ project, tag, tags: tagFilters, excludeTags, search, sort, limit, offset, minPriority, minValue, maxCost }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          let tickets = await listTickets(db, proj.id);

          // Collect all include-tag filters
          const allTags: string[] = [];
          if (tag) allTags.push(tag);
          if (tagFilters) allTags.push(...tagFilters);

          for (const tagStr of allTags) {
            const [prefix, value] = tagStr.split(":");
            const tagObj = await getTag(db, proj.id, prefix, value);
            if (tagObj) {
              const ids = new Set(await listTicketsByTag(db, proj.id, tagObj.id));
              tickets = tickets.filter((t) => ids.has(t.id));
            } else {
              tickets = [];
            }
          }

          // Exclude-tag filters
          if (excludeTags) {
            for (const tagStr of excludeTags) {
              const [prefix, value] = tagStr.split(":");
              const tagObj = await getTag(db, proj.id, prefix, value);
              if (tagObj) {
                const ids = new Set(await listTicketsByTag(db, proj.id, tagObj.id));
                tickets = tickets.filter((t) => !ids.has(t.id));
              }
            }
          }

          // Title search
          if (search) {
            const needle = search.toLowerCase();
            tickets = tickets.filter((t) => t.title.toLowerCase().includes(needle));
          }

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
              throw new Error(`Invalid sort field "${sort}". Valid fields: ${validSortFields.join(", ")}`);
            }
            const key = sort as keyof (typeof filtered)[0];
            filtered.sort((a, b) => (b[key] as number) - (a[key] as number));
          }

          // Pagination
          const total = filtered.length;
          const off = Math.max(0, offset ?? 0);
          let page = filtered.slice(off);
          if (limit != null) {
            if (limit < 0) throw new Error("limit must be a non-negative number");
            page = page.slice(0, limit);
          }

          return { total, offset: off, items: page };
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "ticket_update",
    "Update a ticket's title, description, or scores. Only provided fields are changed. Identified by current title.",
    {
      project: z.string().describe("Project name"),
      title: z.string().describe("Current ticket title"),
      newTitle: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      benefit: fibonacciScore.optional().describe("Benefit score"),
      penalty: fibonacciScore.optional().describe("Penalty score"),
      estimate: fibonacciScore.optional().describe("Estimate score"),
      risk: fibonacciScore.optional().describe("Risk score"),
    },
    async ({ project, title, newTitle, description, benefit, penalty, estimate, risk }) => {
      try {
        const validNewTitle = newTitle ? validateTicketTitle(newTitle) : undefined;
        const validDesc = validateTicketDescription(description);
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const ticket = await getTicketByTitle(db, proj.id, title);
          if (!ticket) throw new Error("Ticket not found");
          await createRevision(db, ticket);
          return updateTicket(db, proj.id, ticket.id, {
            title: validNewTitle,
            description: validDesc,
            benefit,
            penalty,
            estimate,
            risk,
          });
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "ticket_upsert",
    "Create or update a ticket matched by exact title. Returns {ticket, action: 'created'|'updated'}. Idempotent — safe to call repeatedly without duplicate errors.",
    {
      project: z.string().describe("Project name"),
      title: z.string().describe("Ticket title (used as the unique key)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit score (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty score (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Estimate score (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Risk score (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    async ({ project, title, description, benefit, penalty, estimate, risk }) => {
      try {
        const validTitle = validateTicketTitle(title);
        const validDesc = validateTicketDescription(description);
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const existing = await getTicketByTitle(db, proj.id, validTitle);
          if (existing) {
            await createRevision(db, existing);
          }
          return upsertTicket(db, proj.id, validTitle, {
            description: validDesc,
            benefit,
            penalty,
            estimate,
            risk,
          });
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "ticket_delete",
    "Delete a ticket and its relations, revisions, and tag assignments. Irreversible.",
    {
      project: z.string().describe("Project name"),
      title: z.string().describe("Ticket title"),
    },
    async ({ project, title }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const ticket = await getTicketByTitle(db, proj.id, title);
          if (!ticket) throw new Error("Ticket not found");
          return deleteTicket(db, proj.id, ticket.id);
        });
        return textResult({ deleted: result });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "ticket_history",
    "Show revision history for a single ticket. Provide title or id. For project-wide history, use project_history instead.",
    {
      project: z.string().describe("Project name"),
      title: z.string().optional().describe("Ticket title (provide title or id)"),
      id: z.number().optional().describe("Ticket numeric ID (provide title or id)"),
    },
    async ({ project, title, id }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          if (!title && id === undefined) throw new Error("Provide either title or id");
          const ticket = id !== undefined
            ? await getTicketById(db, proj.id, id)
            : await getTicketByTitle(db, proj.id, title!);
          if (!ticket) throw new Error("Ticket not found");
          return listRevisions(db, ticket.id);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "project_history",
    "List revision history across all tickets in a project, newest first. Use instead of calling ticket_history per ticket. Supports since/limit filters.",
    {
      project: z.string().describe("Project name"),
      since: z.string().optional().describe("Only show revisions after this ISO timestamp"),
      limit: z.number().optional().describe("Maximum number of revisions to return"),
    },
    async ({ project, since, limit }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return listProjectRevisions(db, proj.id, since, limit);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  TAG TOOLS
  // =========================================================================

  server.tool(
    "tag_create",
    "Create a tag (prefix:value). Required before using tag_assign. Prefix and value must be lowercase alphanumeric/hyphens. Must be unique per project.",
    {
      project: z.string().describe("Project name"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    async ({ project, prefix, value }) => {
      try {
        const validPrefix = validateTagPrefix(prefix);
        const validValue = validateTagValue(value);
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return createTag(db, proj.id, validPrefix, validValue);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "tag_assign",
    "Assign existing tags to tickets. Prerequisite: create tags first with tag_create. Supports batch: single or multiple tags × single or multiple tickets in one call.",
    {
      project: z.string().describe("Project name"),
      ticket: z.string().optional().describe("Ticket title (single)"),
      tickets: z.array(z.string()).optional().describe("Ticket titles (multiple)"),
      prefix: z.string().optional().describe("Tag prefix (single tag)"),
      value: z.string().optional().describe("Tag value (single tag)"),
      tags: z.array(z.object({ prefix: z.string(), value: z.string() })).optional().describe("Multiple tags to assign"),
    },
    async ({ project, ticket: ticketTitle, tickets: ticketTitles, prefix, value, tags: tagList }) => {
      try {
        // Collect tickets
        const allTickets: string[] = [];
        if (ticketTitle) allTickets.push(ticketTitle);
        if (ticketTitles) allTickets.push(...ticketTitles);
        if (allTickets.length === 0) throw new Error("Provide ticket or tickets");

        // Collect tags
        const allTags: { prefix: string; value: string }[] = [];
        if (prefix && value) allTags.push({ prefix, value });
        if (tagList) allTags.push(...tagList);
        if (allTags.length === 0) throw new Error("Provide prefix+value or tags");

        const validatedTags = allTags.map(t => ({
          prefix: validateTagPrefix(t.prefix),
          value: validateTagValue(t.value),
        }));

        const results = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const out: { ticket: string; tag: string; status: "assigned" | "already_assigned" }[] = [];
          for (const title of allTickets) {
            const ticket = await getTicketByTitle(db, proj.id, title);
            if (!ticket) throw new Error(`Ticket "${title}" not found`);
            for (const t of validatedTags) {
              const tag = await getTag(db, proj.id, t.prefix, t.value);
              if (!tag) throw new Error(`Tag "${t.prefix}:${t.value}" not found. Create it first with tag_create.`);
              const newlyAssigned = await assignTag(db, ticket.id, tag.id);
              out.push({ ticket: title, tag: `${t.prefix}:${t.value}`, status: newlyAssigned ? "assigned" : "already_assigned" });
            }
          }
          return out;
        });
        return textResult(results);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "tag_remove",
    "Remove a tag assignment from a ticket. The tag itself is not deleted.",
    {
      project: z.string().describe("Project name"),
      ticket: z.string().describe("Ticket title"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    async ({ project, ticket: ticketTitle, prefix, value }) => {
      try {
        const validPrefix = validateTagPrefix(prefix);
        const validValue = validateTagValue(value);
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const ticket = await getTicketByTitle(db, proj.id, ticketTitle);
          if (!ticket) throw new Error("Ticket not found");
          const tag = await getTag(db, proj.id, validPrefix, validValue);
          if (!tag) throw new Error("Tag not found");
          const wasRemoved = await removeTag(db, ticket.id, tag.id);
          return { ticket: ticketTitle, tag: `${validPrefix}:${validValue}`, status: wasRemoved ? "removed" : "was_not_assigned" };
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "tag_list",
    "List all tags defined in a project, sorted by prefix then value.",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return listTags(db, proj.id);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "tag_rename",
    "Rename a tag's value. All ticket assignments carry over. New value must not conflict with an existing tag under the same prefix.",
    {
      project: z.string().describe("Project name"),
      prefix: z.string().describe("Tag prefix"),
      oldValue: z.string().describe("Current tag value"),
      newValue: z.string().describe("New tag value"),
    },
    async ({ project, prefix, oldValue, newValue }) => {
      try {
        const validPrefix = validateTagPrefix(prefix);
        const validOldValue = validateTagValue(oldValue);
        const validNewValue = validateTagValue(newValue);
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const tag = await getTag(db, proj.id, validPrefix, validOldValue);
          if (!tag) throw new Error("Tag not found");
          return renameTag(db, proj.id, tag.id, validPrefix, validNewValue);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  WEIGHT CONFIGURATION TOOLS
  // =========================================================================

  server.tool(
    "weight_get",
    "Get the weight configuration (w1-w4) for a project. Defaults are all 1.5 if not customized.",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return getWeights(db, proj.id);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "weight_set",
    "Set weight configuration (w1-w4) for a project. Range: 0-100. Only provided weights change; omitted ones keep their current value.",
    {
      project: z.string().describe("Project name"),
      w1: z.number().optional().describe("Benefit weight"),
      w2: z.number().optional().describe("Penalty weight"),
      w3: z.number().optional().describe("Estimate weight"),
      w4: z.number().optional().describe("Risk weight"),
    },
    async ({ project, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const current = await getWeights(db, proj.id);
          return setWeights(
            db,
            proj.id,
            uw1 ?? current.w1,
            uw2 ?? current.w2,
            uw3 ?? current.w3,
            uw4 ?? current.w4
          );
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "weight_reset",
    "Reset weight configuration to defaults (all 1.5).",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return resetWeights(db, proj.id);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  CALCULATION TOOLS
  // =========================================================================

  server.tool(
    "calc_priority",
    "Calculate weighted priorities for all tickets, sorted descending. Inline w1-w4 override stored weights for this call only. Returns {title, priority, weighted} per ticket. For de-risk-first ordering, use ticket_list with sort='risk' instead.",
    {
      project: z.string().describe("Project name"),
      w1: z.number().optional().describe("Benefit weight (default 1.5). Higher = benefit matters more in value."),
      w2: z.number().optional().describe("Penalty weight (default 1.5). Higher = penalty matters more in value."),
      w3: z.number().optional().describe("Estimate weight (default 1.5). Higher = large estimates are penalised more."),
      w4: z.number().optional().describe("Risk weight (default 1.5). Higher = risky items are penalised more. To de-risk first, sort by risk via ticket_list instead."),
    },
    async ({ project, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
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
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "calc_weights",
    "Calculate each ticket's relative share of total value and cost as percentages. Shows how one ticket compares to the whole backlog.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const tickets = await listTickets(db, proj.id);
          const scoreables: Scoreable[] = tickets;
          return tickets.map((t) => ({
            title: t.title,
            ...calculateRelativeWeights(t, scoreables),
          }));
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  REPORT TOOLS
  // =========================================================================

  server.tool(
    "report_summary",
    "Get project overview: total tickets, breakdown by state tag, and top-N by priority. Good starting point for any project.",
    {
      project: z.string().describe("Project name"),
      topN: z.number().optional().describe("Number of top tickets"),
    },
    async ({ project, topN }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return getProjectSummary(db, proj.id, topN ?? 5);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "report_times",
    "Calculate lead time (created→done) and cycle time (wip→done) per ticket, plus averages. Prerequisite: assign state:wip and state:done tags to tickets.",
    { project: z.string().describe("Project name") },
    async ({ project }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const tickets = await listTickets(db, proj.id);
          const times = await Promise.all(tickets.map((t) => getTicketTimes(db, t.id)));
          return { tickets: times, averageLeadTimeDays: averageLeadTime(times) };
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "report_health",
    "Assess backlog health: high/low priority ratio, open ticket count, total cost. highToLowRatio is null when all tickets are high priority.",
    {
      project: z.string().describe("Project name"),
      threshold: z.number().optional().describe("High priority threshold"),
    },
    async ({ project, threshold }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return getBacklogHealth(db, proj.id, threshold ?? 1.5);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  EVENT LOG & DIFF TOOLS
  // =========================================================================

  server.tool(
    "event_log",
    "Get a unified event stream combining ticket creates, updates, and tag changes. Newest first. Use 'since' to poll incrementally.",
    {
      project: z.string().describe("Project name"),
      since: z.string().optional().describe("Only events after this ISO timestamp"),
      limit: z.number().optional().describe("Maximum number of events to return"),
    },
    async ({ project, since, limit }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return getEventLog(db, proj.id, since, limit ?? 50);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "project_diff",
    "Compare project state against a point in time. Returns new tickets, score/title changes, and tag changes since the timestamp.",
    {
      project: z.string().describe("Project name"),
      since: z.string().describe("ISO timestamp to diff from (e.g. '2026-03-10T00:00:00Z')"),
    },
    async ({ project, since }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return getProjectDiff(db, proj.id, since);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  EXPORT / IMPORT TOOLS
  // =========================================================================

  server.tool(
    "export_csv",
    "Export all tickets as CSV. Optionally includes calculated value, cost, and priority columns.",
    {
      project: z.string().describe("Project name"),
      withCalculations: z.boolean().optional().describe("Include value/cost/priority columns"),
    },
    async ({ project, withCalculations }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return exportCsv(db, proj.id, { withCalculations });
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "export_json",
    "Export project tickets, tags, and optionally revision history as JSON. Use for backups of a single project.",
    {
      project: z.string().describe("Project name"),
      withHistory: z.boolean().optional().describe("Include revisions and audit log"),
    },
    async ({ project, withHistory }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return exportJson(db, proj.id, { withHistory });
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "import_csv",
    "Import tickets from CSV string. Only 'title' column is required; missing score columns default to 1. Tags column optional (comma-separated prefix:value).",
    {
      project: z.string().describe("Project name"),
      csv: z.string().describe("CSV content"),
    },
    async ({ project, csv }) => {
      try {
        checkPayloadSize({ csv });
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return importCsv(db, proj.id, csv);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "import_json",
    "Import tickets and tags from a JSON object with a 'tickets' array. Tags are auto-created during import.",
    {
      project: z.string().describe("Project name"),
      json: z.string().describe("JSON content"),
    },
    async ({ project, json }) => {
      try {
        checkPayloadSize({ json });
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return importJson(db, proj.id, json);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  RELATIONS
  // =========================================================================

  server.tool(
    "relation_create",
    "Create a bidirectional relation between two tickets. Types: blocks, depends-on, relates-to, duplicates, supersedes, precedes, tests, implements, addresses, splits-into, informs, see-also.",
    {
      project: z.string().describe("Project name"),
      source: z.string().describe("Source ticket title"),
      type: z.string().describe("Relation type (e.g. blocks, depends-on, relates-to)"),
      target: z.string().describe("Target ticket title"),
    },
    async ({ project, source, type, target }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const srcTicket = await getTicketByTitle(db, proj.id, source);
          if (!srcTicket) throw new Error(`Ticket "${source}" not found`);
          const tgtTicket = await getTicketByTitle(db, proj.id, target);
          if (!tgtTicket) throw new Error(`Ticket "${target}" not found`);
          await createRelation(db, proj.id, srcTicket.id, tgtTicket.id, type);
          return { created: true, source, type, target };
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "relation_remove",
    "Remove a relation between two tickets (removes both directions). Errors if the relation does not exist.",
    {
      project: z.string().describe("Project name"),
      source: z.string().describe("Source ticket title"),
      type: z.string().describe("Relation type"),
      target: z.string().describe("Target ticket title"),
    },
    async ({ project, source, type, target }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const srcTicket = await getTicketByTitle(db, proj.id, source);
          if (!srcTicket) throw new Error(`Ticket "${source}" not found`);
          const tgtTicket = await getTicketByTitle(db, proj.id, target);
          if (!tgtTicket) throw new Error(`Ticket "${target}" not found`);
          await removeRelation(db, proj.id, srcTicket.id, tgtTicket.id, type);
          return { removed: true };
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "relation_list",
    "List relations for a single ticket. For all relations in a project, use relation_list_all instead.",
    {
      project: z.string().describe("Project name"),
      ticket: z.string().describe("Ticket title"),
    },
    async ({ project, ticket }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          const t = await getTicketByTitle(db, proj.id, ticket);
          if (!t) throw new Error(`Ticket "${ticket}" not found`);
          return listRelations(db, proj.id, t.id);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "relation_list_all",
    "List every relation in a project in one call. Returns source/target IDs, titles, and relation type. Use instead of calling relation_list per ticket.",
    {
      project: z.string().describe("Project name"),
    },
    async ({ project }) => {
      try {
        const result = await withDb(async (db) => {
          const proj = await getProjectByName(db, project);
          if (!proj) throw new Error("Project not found");
          return listProjectRelations(db, proj.id);
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // =========================================================================
  //  BACKUP / RESTORE
  // =========================================================================

  server.tool(
    "backup",
    "Export all projects, tickets, tags, relations, and weights as a single JSON backup. Use restore to reimport.",
    {},
    async () => {
      try {
        const result = await withDb(async (db) => backup(db));
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "restore",
    "Restore projects from a backup JSON string. Fails if any project name already exists in the database.",
    {
      json: z.string().describe("Backup JSON content"),
    },
    async ({ json }) => {
      try {
        checkPayloadSize({ json });
        const result = await withDb(async (db) => restore(db, json));
        return textResult(result);
      } catch (err) {
        return errorResult(err);
      }
    }
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
