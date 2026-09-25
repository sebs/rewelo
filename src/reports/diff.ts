import { DB } from "../db/connection.js";
import { listTickets, Ticket } from "../tickets/repository.js";
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
  // Without descriptions: only the updated tickets' are needed (below), and
  // 100,000 of them ran the 192 MB heap out of memory
  const allTickets = await listTickets(db, projectId, { withDescription: false });
  const newTickets = allTickets
    .filter((t) => new Date(t.created_at).getTime() > sinceMs)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: priority(t),
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

  // The descriptions of the tickets revised since, in one query (the list
  // above leaves them out)
  const descriptions = new Map(
    (await db.all<{ id: number; description: string | null }>(
      `SELECT id, description FROM tickets
       WHERE project_id = ? AND id IN (SELECT ticket_id FROM ticket_revisions WHERE revised_at > ?)`,
      projectId,
      sinceUtc
    )).map((r) => [r.id, r.description])
  );

  const updatedTickets: TicketDiff[] = [];
  for (const [ticketId, before] of earliestRevision) {
    const current = ticketMap.get(ticketId);
    // Deleted since, or created since (then it is only a new ticket)
    if (!current || new Date(current.created_at).getTime() > sinceMs) continue;
    current.description = descriptions.get(ticketId) ?? null;

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

  // 3. Tag changes since timestamp, net per tag: the first change tells
  // whether the ticket had the tag at `since`, the last whether it has it
  // now; assigning and removing a tag in between cancels out. Worked out in
  // SQL, so only net changes are loaded (every change of 100,000 tickets ran
  // the 192 MB heap out of memory).
  const netChanges = await db.all<{
    ticket_id: number;
    ticket_title: string;
    has_it: number;
    name: string;
  }>(
    `WITH span AS (
       SELECT c.ticket_id, min(c.id) AS first_id, max(c.id) AS last_id
       FROM ticket_tag_changes c
       JOIN tickets t ON t.id = c.ticket_id
       WHERE t.project_id = ? AND c.changed_at > ?
       GROUP BY c.ticket_id, c.tag_id
     )
     SELECT s.ticket_id, t.title AS ticket_title, l.action = 'added' AS has_it,
       -- an added tag is on the ticket now, under its current name (it may
       -- have been renamed since); a removed one under the name it had
       CASE WHEN l.action = 'added' THEN coalesce(tg.prefix, l.prefix) || ':' || coalesce(tg.value, l.value)
            ELSE f.prefix || ':' || f.value END AS name
     FROM span s
     JOIN ticket_tag_changes f ON f.id = s.first_id
     JOIN ticket_tag_changes l ON l.id = s.last_id
     JOIN tickets t ON t.id = s.ticket_id
     LEFT JOIN tags tg ON tg.id = l.tag_id
     WHERE (f.action = 'removed') <> (l.action = 'added')
     ORDER BY s.ticket_id, s.first_id`,
    projectId,
    sinceUtc
  );
  const tagDiffMap = new Map<number, TagDiff>();
  for (const change of netChanges) {
    let entry = tagDiffMap.get(change.ticket_id);
    if (!entry) {
      entry = { ticketId: change.ticket_id, ticketTitle: change.ticket_title, added: [], removed: [] };
      tagDiffMap.set(change.ticket_id, entry);
    }
    (change.has_it ? entry.added : entry.removed).push(change.name);
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
