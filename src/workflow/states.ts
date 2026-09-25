import { DB } from "../db/connection.js";

// A ticket's workflow state is its tag with the prefix "state" (a ticket
// holds one value per prefix): state:wip while work is under way, state:done
// once it is done.
//
// States are recognised by name, the same way in every report: a ticket is
// done while it holds the tag now called state:done, and work started when
// it first got a tag called state:wip at that moment. Renaming a state tag
// changes what it means (done -> cancelled is no longer done). An earlier
// rule, "any tag ever called done", counted cancelled tickets as done and
// lost cycle times when a renamed tag was deleted.

export const STATE_PREFIX = "state";
export const WIP = "wip";
export const DONE = "done";

/** Tickets holding the tag now called state:done, in one query */
export async function doneTicketIds(db: DB, projectId: number): Promise<Set<number>> {
  const rows = await db.all<{ ticket_id: number }>(
    `SELECT DISTINCT tt.ticket_id
     FROM ticket_tags tt
     JOIN tags tg ON tg.id = tt.tag_id
     WHERE tg.project_id = ? AND tg.prefix = '${STATE_PREFIX}' AND tg.value = '${DONE}'`,
    projectId
  );
  return new Set(rows.map((r) => r.ticket_id));
}

// Work started when the ticket was first tagged state:wip, under the name
// the tag had then: renaming wip (to e.g. doing) must not erase cycle times,
// and renaming another tag to wip must not invent them.
/** Per ticket, when work started: SQL to extend with conditions and GROUP BY c.ticket_id */
export const WIP_STARTS_SQL = `SELECT c.ticket_id, min(c.changed_at) AS at FROM ticket_tag_changes c
  WHERE c.action = 'added' AND c.prefix = '${STATE_PREFIX}' AND c.value = '${WIP}'`;

// Done means *currently* holding the tag called state:done (as doneTicketIds
// has it); a reopened ticket is not done. Completion is the latest time it
// was added.
/** Per ticket, when it was done: SQL to extend with conditions and GROUP BY c.ticket_id */
export const DONE_AT_SQL = `SELECT c.ticket_id, max(c.changed_at) AS at FROM ticket_tag_changes c
  JOIN tags t ON t.id = c.tag_id AND t.prefix = '${STATE_PREFIX}' AND t.value = '${DONE}'
  JOIN ticket_tags tt ON tt.ticket_id = c.ticket_id AND tt.tag_id = c.tag_id
  WHERE c.action = 'added'`;
