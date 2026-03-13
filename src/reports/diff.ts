import { DB } from "../db/connection.js";
import { listTickets, Ticket } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";

export interface TicketDiff {
  ticketId: number;
  title: string;
  changes: FieldChange[];
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface TagDiff {
  ticketId: number;
  ticketTitle: string;
  added: string[];
  removed: string[];
}

export interface ProjectDiff {
  since: string;
  now: string;
  newTickets: Array<{ id: number; title: string; priority: number }>;
  updatedTickets: TicketDiff[];
  tagChanges: TagDiff[];
}

export async function getProjectDiff(
  db: DB,
  projectId: number,
  since: string
): Promise<ProjectDiff> {
  const now = new Date().toISOString();

  // 1. Tickets created since the timestamp
  const sinceMs = new Date(since).getTime();
  const allTickets = await listTickets(db, projectId);
  const newTickets = allTickets
    .filter((t) => new Date(t.created_at).getTime() >= sinceMs)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
    }));

  // 2. Score/title changes: find revisions since the timestamp and diff against current
  const revisionRows = await db.all<{
    ticket_id: number;
    title: string;
    benefit: number;
    penalty: number;
    estimate: number;
    risk: number;
    revised_at: string;
  }>(
    `SELECT r.ticket_id, r.title, r.benefit, r.penalty, r.estimate, r.risk, r.revised_at
     FROM rw.ticket_revisions r
     JOIN rw.tickets t ON t.id = r.ticket_id
     WHERE t.project_id = ? AND r.revised_at >= ?
     ORDER BY r.revised_at ASC, r.id ASC`,
    projectId,
    since
  );

  // Group revisions by ticket — take the EARLIEST revision as the "before" snapshot
  const earliestRevision = new Map<number, typeof revisionRows[0]>();
  for (const r of revisionRows) {
    if (!earliestRevision.has(r.ticket_id)) {
      earliestRevision.set(r.ticket_id, r);
    }
  }

  const ticketMap = new Map<number, Ticket>();
  for (const t of allTickets) ticketMap.set(t.id, t);

  const updatedTickets: TicketDiff[] = [];
  for (const [ticketId, before] of earliestRevision) {
    const current = ticketMap.get(ticketId);
    if (!current) continue;

    const changes: FieldChange[] = [];
    const fields: Array<{ field: string; key: keyof Ticket }> = [
      { field: "title", key: "title" },
      { field: "benefit", key: "benefit" },
      { field: "penalty", key: "penalty" },
      { field: "estimate", key: "estimate" },
      { field: "risk", key: "risk" },
    ];

    for (const { field, key } of fields) {
      const fromVal = before[key as keyof typeof before];
      const toVal = current[key];
      if (fromVal !== toVal) {
        changes.push({ field, from: fromVal, to: toVal });
      }
    }

    if (changes.length > 0) {
      updatedTickets.push({ ticketId, title: current.title, changes });
    }
  }

  // 3. Tag changes since timestamp
  const tagChangeRows = await db.all<{
    ticket_id: number;
    ticket_title: string;
    action: string;
    prefix: string;
    value: string;
  }>(
    `SELECT c.ticket_id, t.title AS ticket_title, c.action, tg.prefix, tg.value
     FROM rw.ticket_tag_changes c
     JOIN rw.tickets t ON t.id = c.ticket_id
     JOIN rw.tags tg ON tg.id = c.tag_id
     WHERE t.project_id = ? AND c.changed_at >= ?
     ORDER BY c.ticket_id, c.id`,
    projectId,
    since
  );

  const tagDiffMap = new Map<number, TagDiff>();
  for (const r of tagChangeRows) {
    let entry = tagDiffMap.get(r.ticket_id);
    if (!entry) {
      entry = { ticketId: r.ticket_id, ticketTitle: r.ticket_title, added: [], removed: [] };
      tagDiffMap.set(r.ticket_id, entry);
    }
    const label = `${r.prefix}:${r.value}`;
    if (r.action === "added") entry.added.push(label);
    else entry.removed.push(label);
  }

  return {
    since,
    now,
    newTickets,
    updatedTickets,
    tagChanges: [...tagDiffMap.values()],
  };
}
