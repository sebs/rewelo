import { z } from "zod";

// What each tool returns, advertised as its outputSchema and sent as
// structuredContent next to the JSON text. The schemas are exact (no
// additional properties): test/mcp/structured-output.test.ts calls every
// tool, so a field added to a result without its schema fails there.

const score = z.number().int();
const timestamp = z.string().describe("ISO timestamp");
const tagPair = z.object({ prefix: z.string(), value: z.string() });

const project = z.object({
  id: z.number().int(),
  project_uuid: z.string(),
  name: z.string(),
  created_at: timestamp,
});

const ticket = z.object({
  id: z.number().int(),
  ticket_uuid: z.string(),
  project_id: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  benefit: score,
  penalty: score,
  estimate: score,
  risk: score,
  created_at: timestamp,
  updated_at: timestamp,
});

const tag = z.object({
  id: z.number().int(),
  project_id: z.number().int(),
  prefix: z.string(),
  value: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
});

const revision = z.object({
  id: z.number().int(),
  ticket_id: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  benefit: score,
  penalty: score,
  estimate: score,
  risk: score,
  tags: z.array(tagPair),
  revised_at: timestamp,
});

const weights = z.object({
  project_id: z.number().int(),
  w1: z.number(),
  w2: z.number(),
  w3: z.number(),
  w4: z.number(),
});

const deleted = z.object({ deleted: z.literal(true) });

export const outputSchemas = {
  server_version: z.object({ version: z.string() }),

  project_create: project,
  project_list: z.array(project),
  project_delete: deleted,
  project_history: z.array(revision.extend({ ticket_title: z.string().describe("The ticket's current title") })),

  ticket_create: ticket,
  ticket_list: z.object({
    total: z.number().int().describe("Matching tickets, before limit and offset"),
    offset: z.number().int(),
    items: z.array(ticket.extend({
      value: z.number().describe("benefit + penalty"),
      cost: z.number().describe("estimate + risk"),
      priority: z.number().describe("value / cost, rounded to 2 decimals"),
    })),
  }),
  ticket_update: ticket,
  ticket_upsert: z.object({ ticket, action: z.enum(["created", "updated", "unchanged"]) }),
  ticket_delete: deleted,
  ticket_history: z.array(revision),

  tag_create: tag,
  tag_assign: z.array(z.object({
    ticket: z.string(),
    tag: z.string().describe("prefix:value"),
    status: z.enum(["assigned", "already_assigned"]),
    replaced: z.array(z.string()).optional().describe("Values of the same prefix this tag replaced"),
    tagCreated: z.literal(true).optional(),
  })),
  tag_remove: z.object({ ticket: z.string(), tag: z.string(), status: z.enum(["removed", "was_not_assigned"]) }),
  tag_list: z.array(tag),
  tag_delete: z.object({ deleted: z.literal(true), tag: z.string() }),
  tag_rename: tag,

  weight_get: weights,
  weight_set: weights,
  weight_reset: weights,

  calc_priority: z.array(z.object({
    title: z.string(),
    priority: z.number().describe("Unweighted value / cost"),
    weighted: z.number().describe("value / cost with the weights applied"),
  })),
  calc_weights: z.array(z.object({
    title: z.string(),
    relativeBenefit: z.number(),
    relativePenalty: z.number(),
    relativeEstimate: z.number(),
    relativeRisk: z.number(),
  })),

  report_summary: z.object({
    totalTickets: z.number().int(),
    byState: z.record(z.string(), z.number().int()),
    withoutState: z.number().int(),
    topByPriority: z.array(z.object({ title: z.string(), priority: z.number() })),
  }),
  report_times: z.object({
    tickets: z.array(z.object({
      ticketId: z.number().int(),
      ticketTitle: z.string(),
      leadTimeDays: z.number().nullable(),
      cycleTimeDays: z.number().nullable(),
    })),
    averageLeadTimeDays: z.number().nullable(),
    averageCycleTimeDays: z.number().nullable(),
  }),
  report_health: z.object({
    totalTickets: z.number().int(),
    doneTickets: z.number().int(),
    openTickets: z.number().int(),
    highPriorityCount: z.number().int(),
    lowPriorityCount: z.number().int(),
    highToLowRatio: z.number().nullable(),
    totalBacklogCost: z.number(),
  }),
  report_distribution: z.array(z.object({
    dimension: z.string(),
    counts: z.record(z.string(), z.number().int()).describe("Tickets per score"),
  })),
  report_group: z.array(z.object({ value: z.string(), ticketCount: z.number().int(), averagePriority: z.number() })),

  event_log: z.array(z.object({
    timestamp,
    type: z.enum(["ticket_created", "ticket_updated", "ticket_deleted", "tag_added", "tag_removed"]),
    ticketId: z.number().int(),
    ticketTitle: z.string(),
    detail: z.record(z.string(), z.unknown()),
    sequence: z.number().int().describe("Pass the last one as after to poll"),
  })),
  project_diff: z.object({
    since: timestamp,
    now: timestamp,
    newTickets: z.array(z.object({ id: z.number().int(), title: z.string(), priority: z.number() })),
    updatedTickets: z.array(z.object({
      ticketId: z.number().int(),
      title: z.string(),
      changes: z.array(z.object({ field: z.string(), from: z.unknown(), to: z.unknown() })),
    })),
    deletedTickets: z.array(z.object({ id: z.number().int(), title: z.string() })),
    tagChanges: z.array(z.object({
      ticketId: z.number().int(),
      ticketTitle: z.string(),
      added: z.array(z.string()),
      removed: z.array(z.string()),
    })),
  }),

  import_csv: z.object({ imported: z.number().int() }),
  import_json: z.object({
    imported: z.number().int(),
    tagsCreated: z.number().int(),
    relationsCreated: z.number().int(),
    weights: z.object({ w1: z.number(), w2: z.number(), w3: z.number(), w4: z.number() }).optional()
      .describe("The file's weights, which replaced the project's"),
    projectCreated: z.boolean(),
  }),

  relation_create: z.object({ created: z.literal(true), source: z.string(), type: z.string(), target: z.string() }),
  relation_remove: z.object({ removed: z.literal(true) }),
  relation_list: z.array(z.object({
    id: z.number().int(),
    relation_type: z.string(),
    ticket_id: z.number().int(),
    ticket_title: z.string(),
    direction: z.enum(["outgoing", "incoming", "both"]),
  })),
  relation_list_all: z.array(z.object({
    id: z.number().int(),
    source_id: z.number().int(),
    source_title: z.string(),
    target_id: z.number().int(),
    target_title: z.string(),
    relation_type: z.string(),
  })),
} satisfies Record<string, z.ZodType>;
