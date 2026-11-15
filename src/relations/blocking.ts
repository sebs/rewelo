import { DB } from "../db/connection.js";
import { doneTicketIds } from "../workflow/states.js";

// A ticket can't be started while a ticket that blocks it, or that it
// depends on, is still open. Only these two relations say so: precedes
// orders tickets without forbidding work on the later one, and the others
// relate them. A done blocker blocks nothing, and a done ticket is not
// blocked.
/** Per open ticket that has any, the open tickets blocking it, by title */
export async function openBlockerTickets(db: DB, projectId: number): Promise<Map<number, Array<{ id: number; title: string }>>> {
  const rows = await db.all<{ blocked: number; blocker: number; title: string }>(
    `SELECT r.blocked, r.blocker, t.title
     FROM (SELECT CASE relation_type WHEN 'blocks' THEN target_id ELSE source_id END AS blocked,
                  CASE relation_type WHEN 'blocks' THEN source_id ELSE target_id END AS blocker
           FROM ticket_relations
           WHERE project_id = ? AND relation_type IN ('blocks', 'depends-on')) r
     JOIN tickets t ON t.id = r.blocker
     ORDER BY t.title`,
    projectId
  );
  const done = await doneTicketIds(db, projectId);
  const blockers = new Map<number, Array<{ id: number; title: string }>>();
  for (const { blocked, blocker, title } of rows) {
    if (done.has(blocked) || done.has(blocker)) continue;
    blockers.set(blocked, [...(blockers.get(blocked) ?? []), { id: blocker, title }]);
  }
  return blockers;
}

/** Per open ticket that has any, the titles of the open tickets blocking it, sorted */
export async function openBlockers(db: DB, projectId: number): Promise<Map<number, string[]>> {
  const blockers = await openBlockerTickets(db, projectId);
  return new Map([...blockers].map(([id, list]) => [id, list.map((b) => b.title)]));
}
