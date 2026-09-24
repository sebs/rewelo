import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { exactPriority, round2 } from "../calculations/priority.js";

export interface BacklogHealth {
  totalTickets: number;
  doneTickets: number;
  openTickets: number;
  highPriorityCount: number;
  lowPriorityCount: number;
  highToLowRatio: number | null;
  totalBacklogCost: number;
}

/** Tickets holding the tag now called state:done, in one query */
export async function doneTicketIds(db: DB, projectId: number): Promise<Set<number>> {
  const rows = await db.all<{ ticket_id: number }>(
    `SELECT DISTINCT tt.ticket_id
     FROM ticket_tags tt
     JOIN tags tg ON tg.id = tt.tag_id
     WHERE tg.project_id = ? AND tg.prefix = 'state' AND tg.value = 'done'`,
    projectId
  );
  return new Set(rows.map((r) => r.ticket_id));
}

export async function getBacklogHealth(
  db: DB,
  projectId: number,
  highThreshold: number = 1.5
): Promise<BacklogHealth> {
  const tickets = await listTickets(db, projectId);

  const doneIds = await doneTicketIds(db, projectId);

  let highCount = 0;
  let lowCount = 0;
  let backlogCost = 0;

  for (const t of tickets) {
    if (doneIds.has(t.id)) continue;

    const prio = exactPriority(t.benefit, t.penalty, t.estimate, t.risk);
    if (prio >= highThreshold) {
      highCount++;
    } else {
      lowCount++;
    }
    backlogCost += t.estimate + t.risk;
  }

  const doneCount = doneIds.size;

  return {
    totalTickets: tickets.length,
    doneTickets: doneCount,
    openTickets: tickets.length - doneCount,
    highPriorityCount: highCount,
    lowPriorityCount: lowCount,
    highToLowRatio: lowCount > 0 ? round2(highCount / lowCount) : null,
    totalBacklogCost: backlogCost,
  };
}
