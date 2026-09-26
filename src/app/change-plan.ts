import { DB } from "../db/connection.js";
import { compareRankings, type RankingComparison } from "../calculations/scenario.js";
import { doneTicketIds } from "../workflow/states.js";
import type { Scores } from "../domain/scores.js";
import { AppError, sanitizeError } from "../errors.js";
import { createRelation, removeRelation } from "../relations/repository.js";
import { normalizeRelationType } from "../relations/types.js";
import { assignTag, removeTag } from "../tags/assignment.js";
import { ensureTag, getTag } from "../tags/repository.js";
import { createTicket, deleteTicket, listTickets, updateTicket } from "../tickets/repository.js";
import { parseTag, validateTicketDescription, validateTicketTitle } from "../validation/strings.js";
import { getWeights } from "../weights/repository.js";
import { requireTicket } from "./tickets.js";

// A change plan: many changes to one project in one transaction, all or
// none, with how they move the ranking; or tried out first (dry run).

type ScoreChanges = Partial<Scores>;
type RelationChange = { source: string; type: string; target: string };

/** One change, with the parameters of the MCP tool of the same name */
export type Operation =
  | ({ op: "ticket_create"; title: string; description?: string } & ScoreChanges)
  | ({ op: "ticket_update"; title: string; newTitle?: string; description?: string } & ScoreChanges)
  | { op: "ticket_delete"; title: string }
  | { op: "tag_assign"; ticket: string; tag: string }
  | { op: "tag_remove"; ticket: string; tag: string }
  | ({ op: "relation_create" } & RelationChange)
  | ({ op: "relation_remove" } & RelationChange);

// done/reopened: the plan closed a ticket (it leaves the ranking of open
// tickets) or reopened one (it joins it)
type TicketChange = "created" | "updated" | "deleted" | "done" | "reopened";

export interface ChangePlanResult {
  /** false for a dry run, whose changes were rolled back */
  applied: boolean;
  /** Each operation's outcome, in order */
  operations: unknown[];
  /** How the ranking of the open tickets (as simulate ranks) changes */
  ranking: RankingComparison<TicketChange>;
}

// Applies one operation, and notes in changes how it touched a ticket
async function applyOperation(db: DB, projectId: number, op: Operation, changes: Map<number, TicketChange>) {
  switch (op.op) {
    case "ticket_create": {
      const { title, description, ...given } = op;
      const t = await createTicket(db, { projectId, title: validateTicketTitle(title), description: validateTicketDescription(description), ...given });
      changes.set(t.id, "created");
      return { op: op.op, title: t.title };
    }
    case "ticket_update": {
      const { title, newTitle, description, ...given } = op;
      const before = await requireTicket(db, projectId, title);
      const after = await updateTicket(db, projectId, before.id, {
        title: newTitle !== undefined ? validateTicketTitle(newTitle) : undefined,
        description: validateTicketDescription(description),
        ...given,
      });
      const fields = ["title", "description", "benefit", "penalty", "estimate", "risk"] as const;
      const fieldChanges = fields.filter((f) => before[f] !== after[f]).map((f) => ({ field: f, from: before[f], to: after[f] }));
      // An update that changes nothing writes nothing, and isn't one
      if (fieldChanges.length > 0 && changes.get(before.id) !== "created") changes.set(before.id, "updated");
      return { op: op.op, title: after.title, changes: fieldChanges };
    }
    case "ticket_delete": {
      const t = await requireTicket(db, projectId, op.title);
      await deleteTicket(db, projectId, t.id);
      // Created and deleted again: as if it never was
      if (changes.get(t.id) === "created") changes.delete(t.id);
      else changes.set(t.id, "deleted");
      return { op: op.op, title: t.title };
    }
    case "tag_assign": {
      const { prefix, value } = parseTag(op.tag);
      const t = await requireTicket(db, projectId, op.ticket);
      const { tag, created } = await ensureTag(db, projectId, prefix, value);
      const { assigned, replaced } = await assignTag(db, t.id, tag.id);
      return {
        op: op.op,
        ticket: t.title,
        tag: `${prefix}:${value}`,
        status: assigned ? "assigned" : "already_assigned",
        ...(replaced.length > 0 ? { replaced } : {}),
        ...(created ? { tagCreated: true } : {}),
      };
    }
    case "tag_remove": {
      const { prefix, value } = parseTag(op.tag);
      const t = await requireTicket(db, projectId, op.ticket);
      const tag = await getTag(db, projectId, prefix, value);
      if (!tag) throw new AppError(`Tag ${prefix}:${value} not found`);
      return { op: op.op, ticket: t.title, tag: `${prefix}:${value}`, status: (await removeTag(db, t.id, tag.id)) ? "removed" : "was_not_assigned" };
    }
    case "relation_create":
    case "relation_remove": {
      const source = await requireTicket(db, projectId, op.source);
      const target = await requireTicket(db, projectId, op.target);
      if (op.op === "relation_create") await createRelation(db, projectId, source.id, target.id, op.type);
      else await removeRelation(db, projectId, source.id, target.id, op.type);
      return { op: op.op, source: source.title, type: normalizeRelationType(op.type), target: target.title };
    }
  }
}

/**
 * Apply the operations in order, in one transaction: all of them or, when
 * one fails, none. A dry run applies them too, to report what they would
 * do, and rolls them back.
 */
export async function applyChanges(
  db: DB,
  projectId: number,
  operations: Operation[],
  options: { dryRun?: boolean; top: number; limit: number }
): Promise<ChangePlanResult> {
  const run = async (): Promise<ChangePlanResult> => {
    const { w1, w2, w3, w4 } = await getWeights(db, projectId);
    const weights = { w1, w2, w3, w4 };
    // The open tickets, as simulate ranks them: a done ticket is no part of
    // what to do next, and closing one takes it out of the ranking
    const doneBefore = await doneTicketIds(db, projectId);
    const before = (await listTickets(db, projectId, { withDescription: false })).filter((t) => !doneBefore.has(t.id));
    const results = [];
    const changes = new Map<number, TicketChange>();
    for (const [i, op] of operations.entries()) {
      try {
        results.push(await applyOperation(db, projectId, op, changes));
      } catch (err) {
        throw new AppError(`Operation ${i + 1} (${op.op}): ${sanitizeError(err)}. Nothing was changed.`);
      }
    }
    const doneAfter = await doneTicketIds(db, projectId);
    const all = await listTickets(db, projectId, { withDescription: false });
    for (const t of all) {
      if (doneAfter.has(t.id) && !doneBefore.has(t.id) && changes.get(t.id) !== "created") changes.set(t.id, "done");
      if (!doneAfter.has(t.id) && doneBefore.has(t.id)) changes.set(t.id, "reopened");
    }
    const after = all.filter((t) => !doneAfter.has(t.id));
    return {
      applied: !options.dryRun,
      operations: results,
      // By id: an operation can change a title
      ranking: compareRankings({ tickets: before, weights }, { tickets: after, weights }, (t) => t.id, changes, options),
    };
  };
  return options.dryRun ? db.rolledBack(run) : db.transaction(run);
}
