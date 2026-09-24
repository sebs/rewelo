import { DB } from "../db/connection.js";
import { STATE_TAG_IDS } from "../calculations/time.js";
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

export async function getBacklogHealth(
  db: DB,
  projectId: number,
  highThreshold: number = 1.5
): Promise<BacklogHealth> {
  const tickets = await listTickets(db, projectId);

  // Single query: fetch all ticket IDs that have state:done
  const doneRows = await db.all<{ ticket_id: number }>(
    `SELECT DISTINCT tt.ticket_id
     FROM ticket_tags tt
     JOIN tags tg ON tg.id = tt.tag_id
     WHERE tg.project_id = ? AND tt.tag_id IN ${STATE_TAG_IDS}`,
    projectId, "done", "done"
  );
  const doneIds = new Set(doneRows.map((r) => r.ticket_id));

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
