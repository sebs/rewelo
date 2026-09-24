import { DB } from "../db/connection.js";
import { listTickets, Ticket } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";
import { normalizeSince } from "../validation/timestamps.js";

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
  deletedTickets: Array<{ id: number; title: string }>;
  tagChanges: TagDiff[];
}

export async function getProjectDiff(
  db: DB,
  projectId: number,
  since: string
): Promise<ProjectDiff> {
  const now = new Date().toISOString();
  const sinceUtc = normalizeSince(since);

  // Everything strictly after since, like the event log and project history:
  // the state at since itself is the baseline.
  // 1. Tickets created since the timestamp
  const sinceMs = new Date(sinceUtc).getTime();
  const allTickets = await listTickets(db, projectId);
  const newTickets = allTickets
    .filter((t) => new Date(t.created_at).getTime() > sinceMs)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
    }));

  // 2. Score/title changes: find revisions since the timestamp and diff against current
  const revisionRows = await db.all<{
    ticket_id: number;
    title: string;
    description: string | null;
    benefit: number;
    penalty: number;
    estimate: number;
    risk: number;
    revised_at: string;
  }>(
    `SELECT r.ticket_id, r.title, r.description, r.benefit, r.penalty, r.estimate, r.risk, r.revised_at
     FROM ticket_revisions r
     JOIN tickets t ON t.id = r.ticket_id
     WHERE t.project_id = ? AND r.revised_at > ?
     ORDER BY r.revised_at ASC, r.id ASC`,
    projectId,
    sinceUtc
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
    // Deleted since, or created since (then it is only a new ticket)
    if (!current || new Date(current.created_at).getTime() > sinceMs) continue;

    const changes: FieldChange[] = [];
    const fields: Array<{ field: string; key: keyof Ticket }> = [
      { field: "title", key: "title" },
      { field: "description", key: "description" },
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
    tag_id: number;
    action: string;
    prefix: string;
    value: string;
    current_prefix: string | null;
    current_value: string | null;
  }>(
    `SELECT c.ticket_id, t.title AS ticket_title, c.tag_id, c.action, c.prefix, c.value,
            tg.prefix AS current_prefix, tg.value AS current_value
     FROM ticket_tag_changes c
     JOIN tickets t ON t.id = c.ticket_id
     LEFT JOIN tags tg ON tg.id = c.tag_id
     WHERE t.project_id = ? AND c.changed_at > ?
     ORDER BY c.ticket_id, c.id`,
    projectId,
    sinceUtc
  );

  // Report the net change per tag: the first change tells whether the ticket
  // had the tag at `since`, the last whether it has it now. Assigning and
  // removing a tag in between cancels out.
  const perTag = new Map<string, { first: typeof tagChangeRows[0]; last: typeof tagChangeRows[0] }>();
  for (const r of tagChangeRows) {
    const key = `${r.ticket_id}/${r.tag_id}`;
    const seen = perTag.get(key);
    if (seen) seen.last = r;
    else perTag.set(key, { first: r, last: r });
  }
  const tagDiffMap = new Map<number, TagDiff>();
  for (const { first, last } of perTag.values()) {
    const hadIt = first.action === "removed";
    const hasIt = last.action === "added";
    if (hadIt === hasIt) continue;
    let entry = tagDiffMap.get(first.ticket_id);
    if (!entry) {
      entry = { ticketId: first.ticket_id, ticketTitle: first.ticket_title, added: [], removed: [] };
      tagDiffMap.set(first.ticket_id, entry);
    }
    // An added tag is on the ticket now, under its current name (it may have
    // been renamed since); a removed one under the name it had
    if (hasIt) entry.added.push(`${last.current_prefix ?? last.prefix}:${last.current_value ?? last.value}`);
    else entry.removed.push(`${first.prefix}:${first.value}`);
  }
  // A tag deleted and created again is a new tag with the old name: the
  // ticket had state:wip then and has it now, which is no change
  for (const [ticketId, entry] of tagDiffMap) {
    const both = entry.added.filter((name) => entry.removed.includes(name));
    entry.added = entry.added.filter((name) => !both.includes(name));
    entry.removed = entry.removed.filter((name) => !both.includes(name));
    if (entry.added.length === 0 && entry.removed.length === 0) tagDiffMap.delete(ticketId);
  }

  // 4. Tickets deleted since the timestamp
  const deletedTickets = await db.all<{ id: number; title: string }>(
    `SELECT ticket_id AS id, title FROM ticket_deletions
     WHERE project_id = ? AND deleted_at > ?
       -- a ticket created after since did not exist then: no net change
       AND (created_at IS NULL OR created_at <= ?)
     ORDER BY deleted_at, id`,
    projectId,
    sinceUtc,
    sinceUtc
  );

  return {
    since: sinceUtc,
    now,
    newTickets,
    updatedTickets,
    deletedTickets,
    tagChanges: [...tagDiffMap.values()],
  };
}
