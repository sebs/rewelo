import {
  McpServer,
  inputRequired,
  inputResponse,
  isInputRequiredResult,
  type PrimitiveSchemaDefinition,
  type ServerContext,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
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
import { createTag, deleteTag, getTag, listTags, renameTag } from "../tags/repository.js";
import {
  assertOneValuePerPrefix,
  assignTag,
  removeTag,
} from "../tags/assignment.js";
import { listRevisions, listProjectRevisions } from "../revisions/repository.js";
import { byPriority, exactPriority, priority } from "../calculations/priority.js";
import {
  calculateAllRelativeWeights,
} from "../calculations/relative-weights.js";
import { exactWeightedPriority, weightedPriority } from "../calculations/weighted-priority.js";
import { explain, simulate } from "../calculations/scenario.js";
import { getWeights, setWeights, resetWeights, validateWeights } from "../weights/repository.js";
import { getProjectTimes, timesReport } from "../calculations/time.js";
import { exportCsv } from "../export/csv.js";
import { writeJsonExport } from "../export/json.js";
import { importCsv } from "../import/csv.js";
import { importJsonAsProject } from "../import/json.js";
import {
  createRelation,
  removeRelation,
  listRelations,
  listProjectRelations,
} from "../relations/repository.js";
import { normalizeRelationType } from "../relations/types.js";
import { getProjectSummary } from "../reports/summary.js";
import { getBacklogHealth } from "../reports/health.js";
import { getDistribution } from "../reports/distribution.js";
import { groupByTagPrefix } from "../reports/group.js";
import { renderDashboard } from "../reports/dashboard.js";
import { getEventLog } from "../reports/event-log.js";
import { getProjectDiff } from "../reports/diff.js";
import {
  AppError,
  truncate,
  validateProjectName,
  validateTicketTitle,
  validateTicketDescription,
  validateTagPrefix,
  validateTagValue,
  parseTag,
} from "../validation/strings.js";
import { validateDbPath } from "../validation/paths.js";
import { sanitizeError } from "../validation/errors.js";
import { VERSION } from "../version.generated.js";
import { loadConfig, type ReweloConfig } from "../config.js";
import { outputSchemas } from "./output-schemas.js";

// Results are compact JSON, and refused above this size: 30,000 tickets made
// ticket_list 13.7 MB and export_json 19.6 MB, far more than a client can use
const MAX_RESULT_BYTES = 5_000_000;
const DEFAULT_TICKET_LIMIT = 100;

// Data goes out twice: as structuredContent, checked against the tool's
// outputSchema, and as JSON text for clients that read only the text. A
// document (CSV, JSON export, HTML) goes out as text only.
function textResult(data: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> } {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes > MAX_RESULT_BYTES) throw new AppError(tooLarge(`${(bytes / 1_000_000).toFixed(1)} MB`));
  const content = [{ type: "text" as const, text }];
  // An array is valid here: the SDK wraps it as {result: [...]} for the 2025
  // protocol, whose structuredContent must be an object
  return typeof data === "string" ? { content } : { content, structuredContent: data as Record<string, unknown> };
}

const tooLarge = (size: string) =>
  `The result is too large (${size}, max ${MAX_RESULT_BYTES / 1_000_000} MB). Narrow it (limit, offset, filters), or use the rw CLI, which writes exports and dashboards to files.`;

function errorResult(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  // Messages quote input (e.g. a ticket title); never echo a huge one back
  const message = sanitizeError(err);
  return {
    content: [{ type: "text" as const, text: shorten(message) }],
    isError: true,
  };
}

const MAX_ERROR_LENGTH = 1000;

const shorten = (text: string) =>
  text.length > MAX_ERROR_LENGTH ? `${truncate(text, MAX_ERROR_LENGTH)}… (truncated)` : text;

// Errors the SDK makes itself (invalid arguments, unknown tools) quote the
// input too, but don't pass through errorResult: 200,000 invalid array items
// gave a 12 MB answer, a 3 MB tool name a 3 MB one. Shorten them on the way out.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function capErrors(message: any): any {
  if (message?.error && typeof message.error.message === "string") {
    return { ...message, error: { ...message.error, message: shorten(message.error.message), data: undefined } };
  }
  const result = message?.result;
  if (result?.isError && Array.isArray(result.content)) {
    return {
      ...message,
      result: {
        ...result,
        content: result.content.map((c: { type: string; text?: unknown }) =>
          c.type === "text" && typeof c.text === "string" ? { ...c, text: shorten(c.text) } : c
        ),
      },
    };
  }
  return message;
}

// The same message as the CLI's, not zod's bare "Invalid input"
const fibonacciScore = z.union(
  [z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8), z.literal(13), z.literal(21)],
  { error: (issue) => `must be a Fibonacci value (1, 2, 3, 5, 8, 13, 21), got ${JSON.stringify(issue.input)}` }
);

// Every tool says what it does to the database, so a client can run the
// read-only ones without asking and warn before the destructive ones.
// Nothing reaches outside the local database (openWorldHint false).
const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
// Only adds data; an existing title or name is an error, not overwritten
const ADDS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
// Overwrites or removes data
const CHANGES: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
// As CHANGES, but a repeated call with the same arguments changes nothing more
const CHANGES_IDEMPOTENT: ToolAnnotations = { ...CHANGES, idempotentHint: true };
const DELETES: ToolAnnotations = CHANGES_IDEMPOTENT;

const SCORES = ["benefit", "penalty", "estimate", "risk"] as const;
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];

// Form fields for scores the user is asked for: a drop-down of the
// Fibonacci values (form enums are strings)
const SCORE_FIELDS: Record<(typeof SCORES)[number], PrimitiveSchemaDefinition> = {
  benefit: { type: "string", title: "Benefit", description: "Benefit if delivered", enum: FIBONACCI.map(String) },
  penalty: { type: "string", title: "Penalty", description: "Penalty if not delivered", enum: FIBONACCI.map(String) },
  estimate: { type: "string", title: "Estimate", description: "Implementation effort", enum: FIBONACCI.map(String) },
  risk: { type: "string", title: "Risk", description: "Implementation risk and uncertainty", enum: FIBONACCI.map(String) },
};

// A score from the form: the client's answer is not trusted to be valid
function parseScore(score: string, answer: unknown): number | undefined {
  if (answer === undefined) return undefined;
  const value = Number(answer);
  if (!FIBONACCI.includes(value)) {
    throw new AppError(`${score}: must be a Fibonacci value (1, 2, 3, 5, 8, 13, 21), got ${JSON.stringify(answer)}`);
  }
  return value;
}

const MAX_PAYLOAD_BYTES = 1_000_000; // 1 MB per tool call argument

// At most maxRequests calls start per window. A burst over that waits for its
// slot instead of failing: a client that sends many calls at once (pipelined)
// got most of them rejected. Only a backlog longer than maxWaitMs is refused.
class RateLimiter {
  // Start times given out, in order; some may lie in the future
  private slots: number[] = [];
  constructor(
    private maxRequests: number,
    private windowMs: number,
    private maxWaitMs: number,
    // Aborted when the client goes away: calls still waiting then don't run,
    // as their answers could no longer be sent (they used to run unanswered)
    private signal?: AbortSignal
  ) {}

  async acquire(): Promise<void> {
    // Monotonic: with Date.now() setting the clock back an hour locked every
    // tool out for that hour
    const now = performance.now();
    while (this.slots.length > 0 && this.slots[0] <= now - this.windowMs) this.slots.shift();
    const start =
      this.slots.length < this.maxRequests
        ? now
        : Math.max(now, this.slots[this.slots.length - this.maxRequests] + this.windowMs);
    const wait = start - now;
    if (wait > this.maxWaitMs) {
      throw new AppError(
        `Rate limit exceeded (${this.maxRequests} calls per second). Try again in ${Math.ceil((wait - this.maxWaitMs) / 1000)} s.`
      );
    }
    this.slots.push(start);
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, wait);
        function done() {
          clearTimeout(timer);
          resolve();
        }
        this.signal?.addEventListener("abort", done, { once: true });
      });
    }
    if (this.signal?.aborted) throw new AppError("The client disconnected before this call's turn.");
  }
}

// Measures the text in a tool call's arguments: every string, in UTF-8.
// (JSON.stringify would count every backslash and quote in them twice.)
function payloadBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value, "utf-8");
  if (Array.isArray(value)) return value.reduce((sum: number, v) => sum + payloadBytes(v), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((sum: number, v) => sum + payloadBytes(v), 0);
  return 0;
}

function checkPayloadSize(args: unknown): void {
  const bytes = payloadBytes(args);
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new AppError(`Request payload too large (${bytes} bytes, max ${MAX_PAYLOAD_BYTES})`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(fn: (args: any, ctx: ServerContext) => any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (args: any, ctx: ServerContext) => {
    try {
      const result = await fn(args, ctx);
      // A question for the user (inputRequired) goes out as it is
      return isInputRequiredResult(result) ? result : textResult(result);
    } catch (err) {
      return errorResult(err);
    }
  };
}

export function createMcpServer(
  dbPath: string,
  options?: { maxRequestsPerSecond?: number; maxRateLimitWaitMs?: number; signal?: AbortSignal }
): McpServer {
  const validDbPath = validateDbPath(dbPath);
  const rateLimiter = new RateLimiter(options?.maxRequestsPerSecond ?? 100, 1000, options?.maxRateLimitWaitMs ?? 10_000, options?.signal);

  // A broken .rewelo.json should not stop the server: report it when a
  // call actually needs the project fallback.
  let config: ReweloConfig = {};
  let configError: unknown;
  try {
    config = loadConfig();
  } catch (err) {
    configError = err;
  }

  // Say what the fallback is here and now: in the Docker image the working
  // directory is /app, where no .rewelo.json is, and promising one misled
  const instructions = config.project
    ? `The default project is "${config.project}" (from .rewelo.json): the project parameter can be omitted.`
    : `No .rewelo.json with a default project was found from the server's working directory (${process.cwd()}) upwards, so pass the project parameter in every call.`;

  const server = new McpServer({ name: "rewelo", version: VERSION }, { capabilities: { tools: {} }, instructions });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function tool(name: string, description: string, shape: z.ZodRawShape, annotations: ToolAnnotations, handler: (args: any, ctx: ServerContext) => any) {
    // The payload limit applies to every tool, not only the imports: others
    // took 20 MB titles and echoed them back in their errors
    // Strict: a misspelt parameter (benfit, exclude_tags) used to be dropped
    // silently, and the call succeeded without doing what was asked
    const outputSchema = outputSchemas[name as keyof typeof outputSchemas];
    server.registerTool(name, { description, inputSchema: z.strictObject(shape), outputSchema, annotations }, (args: any, ctx: ServerContext) => {
      try {
        checkPayloadSize(args);
      } catch (err) {
        return errorResult(err);
      }
      return handler(args, ctx);
    });
  }

  // Shared connection for the lifetime of the server (important for :memory: DBs)
  // Memoise the promise, not the result: concurrent first calls must share
  // one open + migrate instead of each opening their own connection.
  let sharedDb: Promise<DB> | null = null;

  function openSharedDb(): Promise<DB> {
    sharedDb ??= DB.open(validDbPath)
      .then(async (db) => {
        await migrate(db);
        return db;
      })
      .catch((err) => {
        sharedDb = null;
        throw err;
      });
    return sharedDb;
  }

  // Tool calls share one connection, so run their DB work one at a time:
  // otherwise a call's statements could land inside another call's open
  // transaction (and be rolled back with it).
  let queue: Promise<unknown> = Promise.resolve();

  async function withDb<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    await rateLimiter.acquire();
    const db = await openSharedDb();
    const run = queue.then(() => fn(db));
    queue = run.catch(() => {});
    return run;
  }

  async function withProject<T>(name: string, fn: (db: DB, project: Project) => Promise<T>): Promise<T> {
    return withDb(async (db) => {
      const proj = await getProjectByName(db, name);
      if (!proj) throw new AppError("Project not found");
      return fn(db, proj);
    });
  }

  function resolveProject(project: string | undefined): string {
    if (project !== undefined && project.trim() === "") throw new AppError("project must not be empty");
    if (project === undefined && configError) throw configError;
    const name = project ?? config.project;
    if (!name) throw new AppError("No project specified and no .rewelo.json config found");
    return name;
  }

  async function resolveTicket(db: DB, projectId: number, title?: string, id?: number): Promise<Ticket> {
    if (!title && id === undefined) throw new AppError("Provide either title or id");
    if (title && id !== undefined) throw new AppError("Provide either title or id, not both");
    const ticket = id !== undefined
      ? await getTicketById(db, projectId, id)
      : await getTicketByTitle(db, projectId, title!);
    if (!ticket) throw new AppError(title ? `Ticket "${title}" not found` : `Ticket #${id} not found`);
    return ticket;
  }

  // Whether the client can show the user a form (elicitation). Asking one
  // that can't fails the call instead of going ahead without an answer.
  function canAskUser(): boolean {
    const elicitation = server.server.getClientCapabilities()?.elicitation;
    // An empty elicitation capability means form mode (the pre-mode rule)
    return elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined);
  }

  // =========================================================================
  //  VERSION TOOL
  // =========================================================================

  tool(
    "server_version",
    "Return the server version string. Use to verify which build is running.",
    {},
    READ,
    async () => textResult({ version: VERSION })
  );

  // =========================================================================
  //  PROJECT TOOLS
  // =========================================================================

  tool(
    "project_create",
    "Create a new project. Name must be unique; letters, digits, spaces, hyphens and underscores (not starting with a space), max 100 characters.",
    { name: z.string().describe("Project name") },
    ADDS,
    safe(async ({ name }) => {
      const validName = validateProjectName(name);
      return withDb((db) => createProject(db, validName));
    })
  );

  tool("project_list", "List all projects with their IDs and creation dates.", {}, READ,
    safe(() => withDb((db) => listProjects(db)))
  );

  tool(
    "project_delete",
    "Delete a project and all its tickets, tags, relations, and history. Irreversible. When the client supports forms (elicitation), the user is asked to confirm first, as rw project delete does.",
    { name: z.string().describe("Project name") },
    DELETES,
    safe(async ({ name }, ctx) => {
      const answer = inputResponse(ctx.mcpReq.inputResponses, "confirm");
      if (answer.kind === "missing" && canAskUser()) {
        // Like every other tool (and the CLI), a missing project is an
        // error, and asking to confirm its deletion is pointless
        const tickets = await withProject(name, async (db, proj) =>
          (await db.all<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE project_id = ?", proj.id))[0].n
        );
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Delete project "${name}" and all its data (${tickets} ticket${tickets === 1 ? "" : "s"}, their tags, relations and history)? This cannot be undone.`,
              requestedSchema: {
                type: "object",
                properties: { confirm: { type: "boolean", title: "Delete the project", default: false } },
                required: ["confirm"],
              },
            }),
          },
        });
      }
      if (answer.kind !== "missing" && !(answer.kind === "elicit" && answer.action === "accept" && answer.content?.confirm === true)) {
        throw new AppError(`Project "${name}" was not deleted: the user did not confirm.`);
      }
      if (!(await withDb((db) => deleteProject(db, name)))) throw new AppError("Project not found");
      return { deleted: true };
    })
  );

  // =========================================================================
  //  TICKET TOOLS
  // =========================================================================

  tool(
    "ticket_create",
    "Create a new ticket with Fibonacci scores (1,2,3,5,8,13,21). Title must be unique per project. When the client supports forms (elicitation), the user is asked for omitted scores; otherwise, or when the user declines, they default to 1. Priority = (benefit + penalty) / (estimate + risk). Use ticket_upsert instead if the title may already exist.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title (max 500 chars)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit if delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty if not delivered (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Implementation effort (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Implementation risk/uncertainty (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    ADDS,
    safe(async ({ project, title, description, ...given }, ctx) => {
      const validTitle = validateTicketTitle(title);
      const validDesc = validateTicketDescription(description);
      const projectName = resolveProject(project);
      const missing = SCORES.filter((score) => given[score] === undefined);
      const answer = inputResponse(ctx.mcpReq.inputResponses, "scores");
      if (missing.length > 0 && answer.kind === "missing" && canAskUser()) {
        // Fail now on a missing project or a taken title, not after the user
        // has filled in the form
        await withProject(projectName, async (db, proj) => {
          if (await getTicketByTitle(db, proj.id, validTitle)) throw new AppError(`A ticket with title "${validTitle}" already exists in this project`);
        });
        return inputRequired({
          inputRequests: {
            scores: inputRequired.elicit({
              message: `Score the new ticket "${validTitle}". Left out, a score is 1.`,
              requestedSchema: {
                type: "object",
                properties: Object.fromEntries(missing.map((score) => [score, SCORE_FIELDS[score]])),
              },
            }),
          },
        });
      }
      if (answer.kind === "elicit" && answer.action === "cancel") {
        throw new AppError(`Ticket "${validTitle}" was not created: the user cancelled.`);
      }
      const asked = answer.kind === "elicit" && answer.action === "accept" ? answer.content ?? {} : {};
      const scores = Object.fromEntries(
        SCORES.map((score) => [score, given[score] ?? parseScore(score, asked[score])])
      );
      return withProject(projectName, (db, proj) =>
        createTicket(db, { projectId: proj.id, title: validTitle, description: validDesc, ...scores })
      );
    })
  );

  tool(
    "ticket_list",
    "List tickets with calculated value, cost, and priority. Supports tag filters (intersection), exclude-tags, title search, score thresholds, sort, and limit/offset pagination. Returns {total, offset, items[]}.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      tag: z.string().optional().describe("Filter by tag (prefix:value) — single tag, kept for backward compat"),
      tags: z.array(z.string()).optional().describe("Filter by multiple tags (intersection). Each as prefix:value"),
      excludeTags: z.array(z.string()).optional().describe("Exclude tickets with these tags. Each as prefix:value"),
      search: z.string().optional().describe("Filter by title substring (case-insensitive)"),
      sort: z.string().optional().describe("Sort descending by: priority, benefit, penalty, estimate, risk, value, cost"),
      limit: z.number().int().nonnegative().optional().describe("Max number of results to return (default 100; total gives the full count)"),
      offset: z.number().int().nonnegative().optional().describe("Skip first N results (for pagination)"),
      minPriority: z.number().optional().describe("Minimum priority, compared with the exact value/cost (21/13 = 1.615 is below 1.62, though returned as 1.62)"),
      minValue: z.number().optional().describe("Minimum value (benefit+penalty) threshold"),
      maxCost: z.number().optional().describe("Maximum cost (estimate+risk) threshold"),
    },
    READ,
    safe(({ project, tag, tags: tagFilters, excludeTags, search, sort, limit, offset, minPriority, minValue, maxCost }) =>
      withProject(resolveProject(project), async (db, proj) => {
        // Build tag filter arrays
        const includeTags: { prefix: string; value: string }[] = [];
        if (tag) { includeTags.push(parseTag(tag)); }
        if (tagFilters) for (const ts of tagFilters) { includeTags.push(parseTag(ts)); }

        const excludeTagPairs: { prefix: string; value: string }[] = [];
        if (excludeTags) for (const ts of excludeTags) { excludeTagPairs.push(parseTag(ts)); }

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
        if (minPriority != null) filtered = filtered.filter((t) => exactPriority(t.benefit, t.penalty, t.estimate, t.risk) >= minPriority);
        if (minValue != null) filtered = filtered.filter((t) => t.value >= minValue);
        if (maxCost != null) filtered = filtered.filter((t) => t.cost <= maxCost);

        if (sort !== undefined) {
          const validSortFields = ["priority", "benefit", "penalty", "estimate", "risk", "value", "cost"];
          if (!validSortFields.includes(sort)) {
            throw new AppError(`Invalid sort field "${sort}". Valid fields: ${validSortFields.join(", ")}`);
          }
          const key = sort as keyof (typeof filtered)[0];
          filtered.sort(key === "priority" ? byPriority : (a, b) => (b[key] as number) - (a[key] as number));
        }

        // Pagination
        const total = filtered.length;
        // Pages of 100 unless a limit is given; total says how many there are
        const off = offset ?? 0;
        const page = filtered.slice(off, off + (limit ?? DEFAULT_TICKET_LIMIT));

        return { total, offset: off, items: page };
      })
    )
  );

  tool(
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
    CHANGES,
    safe(async ({ project, title, newTitle, description, benefit, penalty, estimate, risk }) => {
      const validNewTitle = newTitle !== undefined ? validateTicketTitle(newTitle) : undefined;
      const validDesc = validateTicketDescription(description);
      return withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title);
        return updateTicket(db, proj.id, ticket.id, {
          title: validNewTitle, description: validDesc, benefit, penalty, estimate, risk,
        });
      });
    })
  );

  tool(
    "ticket_upsert",
    "Create or update a ticket matched by exact title. Returns {ticket, action: 'created'|'updated'|'unchanged'}. Idempotent — safe to call repeatedly without duplicate errors.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title (used as the unique key)"),
      description: z.string().optional().describe("Ticket description (max 10000 chars)"),
      benefit: fibonacciScore.optional().describe("Benefit score (Fibonacci: 1,2,3,5,8,13,21)"),
      penalty: fibonacciScore.optional().describe("Penalty score (Fibonacci: 1,2,3,5,8,13,21)"),
      estimate: fibonacciScore.optional().describe("Estimate score (Fibonacci: 1,2,3,5,8,13,21)"),
      risk: fibonacciScore.optional().describe("Risk score (Fibonacci: 1,2,3,5,8,13,21)"),
    },
    CHANGES_IDEMPOTENT,
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

  tool(
    "ticket_delete",
    "Delete a ticket and its relations, revisions, and tag assignments. Irreversible.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title"),
    },
    DELETES,
    safe(({ project, title }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title);
        if (!(await deleteTicket(db, proj.id, ticket.id))) throw new AppError(`Ticket "${title}" not found`);
        return { deleted: true };
      })
    )
  );

  tool(
    "ticket_history",
    "Show revision history for a single ticket. Provide title or id. For project-wide history, use project_history instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().optional().describe("Ticket title (provide title or id)"),
      id: z.number().int().positive().optional().describe("Ticket numeric ID (provide title or id)"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of revisions to return (oldest first)"),
      offset: z.number().int().nonnegative().optional().describe("Number of revisions to skip"),
    },
    READ,
    safe(({ project, title, id, limit, offset }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, title, id);
        return listRevisions(db, ticket.id, limit, offset);
      })
    )
  );

  tool(
    "project_history",
    "List revision history across all tickets in a project: newest first, or with since the revisions right after it, oldest first. Use instead of calling ticket_history per ticket. Page with limit and offset.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().optional().describe("Only show revisions after this ISO timestamp (then oldest first)"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of revisions to return"),
      offset: z.number().int().nonnegative().optional().describe("Number of revisions to skip"),
    },
    READ,
    safe(({ project, since, limit, offset }) =>
      withProject(resolveProject(project), (db, proj) => listProjectRevisions(db, proj.id, since, limit, offset))
    )
  );

  // =========================================================================
  //  TAG TOOLS
  // =========================================================================

  tool(
    "tag_create",
    "Create a tag (prefix:value). Required before using tag_assign. Prefix and value must be lowercase alphanumeric/hyphens. Must be unique per project.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    ADDS,
    safe(async ({ project, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return withProject(resolveProject(project), (db, proj) => createTag(db, proj.id, validPrefix, validValue));
    })
  );

  tool(
    "tag_assign",
    "Assign tags to tickets, creating tags that don't exist yet (marked tagCreated), as rw tag assign does. Supports batch: single or multiple tags × single or multiple tickets in one call. A ticket holds one value per prefix: assigning state:done replaces state:wip (reported as 'replaced'), and requesting two values of one prefix is an error.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      ticket: z.string().optional().describe("Ticket title (single)"),
      tickets: z.array(z.string()).optional().describe("Ticket titles (multiple)"),
      prefix: z.string().optional().describe("Tag prefix (single tag)"),
      value: z.string().optional().describe("Tag value (single tag)"),
      tags: z.array(z.object({ prefix: z.string(), value: z.string() })).optional().describe("Multiple tags to assign"),
    },
    CHANGES_IDEMPOTENT,
    safe(async ({ project, ticket: ticketTitle, tickets: ticketTitles, prefix, value, tags: tagList }) => {
      // concat, not push(...): spreading a large array overflows the stack
      const allTickets: string[] = (ticketTitle ? [ticketTitle] : []).concat(ticketTitles ?? []);
      if (allTickets.length === 0) throw new AppError("Provide ticket or tickets");

      const allTags: { prefix: string; value: string }[] = [];
      // Half a tag is a mistake, even when tags is given as well
      if ((prefix === undefined) !== (value === undefined)) throw new AppError("Provide both prefix and value, or neither");
      if (prefix !== undefined && value !== undefined) allTags.push({ prefix, value });
      if (tagList) for (const t of tagList) allTags.push(t);
      if (allTags.length === 0) throw new AppError("Provide prefix+value or tags");

      const validatedTags = allTags.map(t => ({
        prefix: validateTagPrefix(t.prefix),
        value: validateTagValue(t.value),
      }));
      assertOneValuePerPrefix(validatedTags);

      return withProject(resolveProject(project), async (db, proj) => {
        // Resolve the tickets first, then create and assign in one
        // transaction, so a missing ticket aborts the whole batch instead of
        // half of it (and leaves no new tags behind)
        const tickets: { title: string; id: number }[] = [];
        for (const title of new Set(allTickets)) {
          const ticket = await resolveTicket(db, proj.id, title);
          if (!tickets.some((t) => t.id === ticket.id)) tickets.push({ title: ticket.title, id: ticket.id });
        }

        return db.transaction(async () => {
          // Created like rw tag assign and the imports do: requiring
          // tag_create first made the documented examples fail
          const tags: { label: string; id: number; created: boolean }[] = [];
          for (const t of validatedTags) {
            const existing = await getTag(db, proj.id, t.prefix, t.value);
            const tag = existing ?? (await createTag(db, proj.id, t.prefix, t.value));
            if (!tags.some((known) => known.id === tag.id)) tags.push({ label: `${t.prefix}:${t.value}`, id: tag.id, created: !existing });
          }
          const out: { ticket: string; tag: string; status: "assigned" | "already_assigned"; replaced?: string[]; tagCreated?: true }[] = [];
          for (const ticket of tickets) {
            for (const tag of tags) {
              const { assigned, replaced } = await assignTag(db, ticket.id, tag.id);
              out.push({
                ticket: ticket.title,
                tag: tag.label,
                status: assigned ? "assigned" : "already_assigned",
                ...(replaced.length > 0 ? { replaced } : {}),
                ...(tag.created && ticket === tickets[0] ? { tagCreated: true as const } : {}),
              });
            }
          }
          return out;
        });
      });
    })
  );

  tool(
    "tag_remove",
    "Remove a tag assignment from a ticket. The tag itself is not deleted.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      ticket: z.string().describe("Ticket title"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    CHANGES_IDEMPOTENT,
    safe(async ({ project, ticket: ticketTitle, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return withProject(resolveProject(project), async (db, proj) => {
        const ticket = await resolveTicket(db, proj.id, ticketTitle);
        const tag = await getTag(db, proj.id, validPrefix, validValue);
        if (!tag) throw new AppError("Tag not found");
        const wasRemoved = await removeTag(db, ticket.id, tag.id);
        return { ticket: ticket.title, tag: `${validPrefix}:${validValue}`, status: wasRemoved ? "removed" : "was_not_assigned" };
      });
    })
  );

  tool(
    "tag_list",
    "List all tags defined in a project, sorted by prefix then value.",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => listTags(db, proj.id)))
  );

  tool(
    "tag_delete",
    "Delete a tag that no ticket holds (use tag_remove on its tickets first). Tickets' tag history is kept.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix"),
      value: z.string().describe("Tag value"),
    },
    DELETES,
    safe(async ({ project, prefix, value }) => {
      const validPrefix = validateTagPrefix(prefix);
      const validValue = validateTagValue(value);
      return withProject(resolveProject(project), async (db, proj) => {
        const tag = await getTag(db, proj.id, validPrefix, validValue);
        if (!tag) throw new AppError("Tag not found");
        await deleteTag(db, proj.id, tag.id);
        return { deleted: true, tag: `${validPrefix}:${validValue}` };
      });
    })
  );

  tool(
    "tag_rename",
    "Rename a tag's value. All ticket assignments carry over. New value must not conflict with an existing tag under the same prefix.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix"),
      oldValue: z.string().describe("Current tag value"),
      newValue: z.string().describe("New tag value"),
    },
    CHANGES,
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

  tool(
    "weight_get",
    "Get the weight configuration (w1-w4) for a project. Defaults are all 1.5 if not customized.",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => getWeights(db, proj.id)))
  );

  tool(
    "weight_set",
    "Set weight configuration (w1-w4) for a project. Each weight is 0 or between 0.01 and 100. Only provided weights change; omitted ones keep their current value.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      w1: z.number().optional().describe("Benefit weight"),
      w2: z.number().optional().describe("Penalty weight"),
      w3: z.number().optional().describe("Estimate weight"),
      w4: z.number().optional().describe("Risk weight"),
    },
    CHANGES_IDEMPOTENT,
    safe(({ project, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) => {
      // As rw config weights --set: nothing to set is a mistake, not a no-op
      if ([uw1, uw2, uw3, uw4].every((w) => w === undefined)) throw new AppError("Provide at least one of w1, w2, w3, w4");
      return withProject(resolveProject(project), async (db, proj) => {
        const current = await getWeights(db, proj.id);
        return setWeights(db, proj.id, uw1 ?? current.w1, uw2 ?? current.w2, uw3 ?? current.w3, uw4 ?? current.w4);
      });
    })
  );

  tool(
    "weight_reset",
    "Reset weight configuration to defaults (all 1.5).",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    CHANGES_IDEMPOTENT,
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => resetWeights(db, proj.id)))
  );

  // =========================================================================
  //  CALCULATION TOOLS
  // =========================================================================

  tool(
    "calc_priority",
    "Calculate weighted priorities for all tickets, sorted descending. Inline w1-w4 override stored weights for this call only. Returns {title, priority, weighted} per ticket. For de-risk-first ordering, use ticket_list with sort='risk' instead.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      tag: z.string().optional().describe("Only tickets with this tag (prefix:value)"),
      w1: z.number().optional().describe("Benefit weight (default 1.5). Higher = benefit matters more in value."),
      w2: z.number().optional().describe("Penalty weight (default 1.5). Higher = penalty matters more in value."),
      w3: z.number().optional().describe("Estimate weight (default 1.5). Higher = large estimates are penalised more."),
      w4: z.number().optional().describe("Risk weight (default 1.5). Higher = risky items are penalised more. To de-risk first, sort by risk via ticket_list instead."),
    },
    READ,
    safe(({ project, tag, w1: uw1, w2: uw2, w3: uw3, w4: uw4 }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id, { includeTags: tag !== undefined ? [parseTag(tag)] : [], withDescription: false });
        const config = await getWeights(db, proj.id);
        const w1 = uw1 ?? config.w1;
        const w2 = uw2 ?? config.w2;
        const w3 = uw3 ?? config.w3;
        const w4 = uw4 ?? config.w4;
        validateWeights(w1, w2, w3, w4);

        // Sort on the unrounded weighted priority; return the rounded one
        const exact = (t: Ticket) => exactWeightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4);
        return [...tickets]
          .sort((a, b) => exact(b) - exact(a))
          .map((t) => ({
            title: t.title,
            priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
            weighted: weightedPriority(t.benefit, t.penalty, t.estimate, t.risk, w1, w2, w3, w4),
          }));
      })
    )
  );

  tool(
    "calc_weights",
    "Calculate each ticket's relative share of total value and cost as fractions between 0 and 1 (0.25 = 25%). Shows how one ticket compares to the whole backlog, or to a tagged subset when tag is given.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      tag: z.string().optional().describe("Only compare tickets with this tag (prefix:value)"),
    },
    READ,
    safe(({ project, tag }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id, { includeTags: tag !== undefined ? [parseTag(tag)] : [], withDescription: false });
        return calculateAllRelativeWeights(tickets).map((t) => ({
          title: t.title,
          relativeBenefit: t.relativeBenefit,
          relativePenalty: t.relativePenalty,
          relativeEstimate: t.relativeEstimate,
          relativeRisk: t.relativeRisk,
        }));
      })
    )
  );

  const scoreChange = {
    title: z.string().describe("Ticket title"),
    benefit: fibonacciScore.optional(),
    penalty: fibonacciScore.optional(),
    estimate: fibonacciScore.optional(),
    risk: fibonacciScore.optional(),
  };

  tool(
    "simulate",
    "What-if: rank the tickets as calc_priority does, under hypothetical score changes, new or removed tickets and weights, and compare with the current ranking. Nothing is written; use ticket_update to apply a scenario. Returns the scenario's top tickets and every ticket that is changed, added, removed or moves, with its rank and priority before and after.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      tag: z.string().optional().describe("Only rank tickets with this tag (prefix:value)"),
      changes: z.array(z.strictObject(scoreChange)).optional().describe("Hypothetical scores for existing tickets; omitted scores stay"),
      add: z.array(z.strictObject(scoreChange)).optional().describe("Hypothetical new tickets; omitted scores are 1"),
      remove: z.array(z.string()).optional().describe("Titles of tickets to leave out"),
      weights: z.strictObject({ w1: z.number().optional(), w2: z.number().optional(), w3: z.number().optional(), w4: z.number().optional() })
        .optional().describe("Hypothetical weights; omitted ones keep the project's"),
      top: z.number().int().positive().optional().describe("How many of the scenario's top tickets to list (default 10)"),
      limit: z.number().int().nonnegative().optional().describe("Max number of changed or moved tickets to return (default 100)"),
    },
    READ,
    safe(({ project, tag, changes, add, remove, weights, top, limit }) => {
      for (const t of add ?? []) validateTicketTitle(t.title);
      return withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id, { includeTags: tag !== undefined ? [parseTag(tag)] : [], withDescription: false });
        const { w1, w2, w3, w4 } = await getWeights(db, proj.id);
        return simulate(tickets, { w1, w2, w3, w4 }, { changes, add, remove, weights }, { top: top ?? 10, limit: limit ?? 100 });
      });
    })
  );

  tool(
    "explain_priority",
    "Explain one ticket's priority: the formula with its scores and the project's weights, its rank as calc_priority ranks, and what it would take to reach the top N: the priority to beat, and the smallest change of each single score that gets there.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      title: z.string().describe("Ticket title"),
      tag: z.string().optional().describe("Rank only among tickets with this tag (prefix:value); the ticket must have it"),
      top: z.number().int().positive().optional().describe("The rank to reach (default 1)"),
    },
    READ,
    safe(({ project, title, tag, top }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const tickets = await listTickets(db, proj.id, { includeTags: tag !== undefined ? [parseTag(tag)] : [], withDescription: false });
        const { w1, w2, w3, w4 } = await getWeights(db, proj.id);
        if (tag !== undefined && !tickets.some((t) => t.title === title)) {
          await resolveTicket(db, proj.id, title);
          throw new AppError(`Ticket "${title}" does not have the tag ${tag}`);
        }
        return explain(tickets, { w1, w2, w3, w4 }, title, top ?? 1);
      })
    )
  );

  // =========================================================================
  //  REPORT TOOLS
  // =========================================================================

  tool(
    "report_summary",
    "Get project overview: total tickets, breakdown by state tag, and the top-N open (not state:done) tickets by priority. Good starting point for any project.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      topN: z.number().int().nonnegative().optional().describe("Number of top tickets"),
    },
    READ,
    safe(({ project, topN }) =>
      withProject(resolveProject(project), (db, proj) => getProjectSummary(db, proj.id, topN ?? 5))
    )
  );

  tool(
    "report_times",
    "Calculate lead time (created→done) and cycle time (wip→done) per ticket, plus their averages (whole days; null where there is no value). Prerequisite: assign state:wip and state:done tags to tickets.",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) =>
      withProject(resolveProject(project), async (db, proj) => {
        const times = await getProjectTimes(db, proj.id);
        return timesReport(times);
      })
    )
  );

  tool(
    "report_health",
    "Assess backlog health: high/low priority ratio, open ticket count, total cost. highToLowRatio is null when all tickets are high priority.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      threshold: z.number().optional().describe("High priority threshold (default 1.5), compared with the exact value/cost, not the rounded priority"),
    },
    READ,
    safe(({ project, threshold }) =>
      withProject(resolveProject(project), (db, proj) => getBacklogHealth(db, proj.id, threshold ?? 1.5))
    )
  );

  tool(
    "report_distribution",
    "Count how many tickets use each Fibonacci score (1-21), per dimension (benefit, penalty, estimate, risk).",
    { project: z.string().optional().describe("Project name (falls back to .rewelo.json)") },
    READ,
    safe(({ project }) => withProject(resolveProject(project), (db, proj) => getDistribution(db, proj.id)))
  );

  tool(
    "report_group",
    "Group tickets by the values of one tag prefix (e.g. team), with ticket count and average priority per value.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      prefix: z.string().describe("Tag prefix to group by"),
    },
    READ,
    safe(async ({ project, prefix }) => {
      const validPrefix = validateTagPrefix(prefix);
      return withProject(resolveProject(project), (db, proj) => groupByTagPrefix(db, proj.id, validPrefix));
    })
  );

  tool(
    "report_dashboard",
    "Render a self-contained HTML dashboard (tickets, distribution, health, relations). Returns the HTML document as text.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      limit: z.number().int().nonnegative().optional().describe("Rows per table (default 500)"),
    },
    READ,
    safe(({ project, limit }) =>
      withProject(resolveProject(project), (db, proj) =>
        renderDashboard(db, proj.id, proj.name, {
          generatedAt: new Date().toISOString(),
          limit,
          limitHint: "a higher <code>limit</code> for <code>report_dashboard</code>",
        })
      )
    )
  );

  // =========================================================================
  //  EVENT LOG & DIFF TOOLS
  // =========================================================================

  tool(
    "event_log",
    "Get a unified event stream combining ticket creates, updates, deletes, and tag changes. Without since/after: the newest events, newest first. With since or after: the events after it, oldest first. To poll incrementally without missing events, pass the sequence of the last event received as the next after.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().optional().describe("Only events after this ISO timestamp (then oldest first)"),
      after: z.number().int().nonnegative().optional().describe("Only events written after this sequence number (an earlier event's sequence), in write order"),
      limit: z.number().int().nonnegative().optional().describe("Maximum number of events to return (default 50)"),
    },
    READ,
    safe(({ project, since, after, limit }) =>
      withProject(resolveProject(project), (db, proj) => getEventLog(db, proj.id, since, limit ?? 50, after))
    )
  );

  tool(
    "project_diff",
    "Compare project state against a point in time. Returns new tickets, title/description/score changes, deleted tickets, and tag changes since the timestamp.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      since: z.string().describe("ISO timestamp to diff from (e.g. '2026-03-10T00:00:00Z')"),
    },
    READ,
    safe(({ project, since }) =>
      withProject(resolveProject(project), (db, proj) => getProjectDiff(db, proj.id, since))
    )
  );

  // =========================================================================
  //  EXPORT / IMPORT TOOLS
  // =========================================================================

  tool(
    "export_csv",
    "Export all tickets as CSV. Optionally includes calculated value, cost, and priority columns.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      withCalculations: z.boolean().optional().describe("Include value/cost/priority columns"),
    },
    READ,
    safe(({ project, withCalculations }) =>
      withProject(resolveProject(project), (db, proj) => exportCsv(db, proj.id, { withCalculations }))
    )
  );

  tool(
    "export_json",
    "Export a project as JSON: tickets, tags, relations and weights, and with withHistory each ticket's revisions and tag changes. Use for backups of a single project; import_json restores it.",
    {
      project: z.string().optional().describe("Project name (falls back to .rewelo.json)"),
      withHistory: z.boolean().optional().describe("Include revisions and audit log"),
    },
    READ,
    safe(({ project, withHistory }) =>
      withProject(resolveProject(project), async (db, proj) => {
        // Built piece by piece and given up past the result limit: the whole
        // export of a big project in memory killed the server (heap out of
        // memory), only for the result to be refused as too large
        let text = "";
        await writeJsonExport(db, proj.id, { withHistory, indent: false }, async (chunks) => {
          for await (const chunk of chunks) {
            text += chunk;
            // UTF-16 units, at most the bytes: over this is over in bytes too
            if (text.length > MAX_RESULT_BYTES) throw new AppError(tooLarge(`over ${MAX_RESULT_BYTES / 1_000_000} MB`));
          }
        });
        return text;
      })
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

  // =========================================================================
  //  RELATIONS
  // =========================================================================

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

  const connect = server.connect.bind(server);
  server.connect = (transport) => {
    const send = transport.send.bind(transport);
    transport.send = (message, sendOptions) => send(capErrors(message), sendOptions);
    return connect(transport);
  };

  return server;
}

export async function startMcpServer(dbPath: string): Promise<void> {
  // The transport closes when stdin ends: the client is gone
  const disconnected = new AbortController();
  process.stdin.once("end", () => disconnected.abort());
  const server = createMcpServer(dbPath, { signal: disconnected.signal });
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    disconnected.abort();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  // stdout carries the protocol; say on stderr what is running where
  console.error(`rewelo ${VERSION} MCP server on stdio transport, database ${dbPath}`);
}
