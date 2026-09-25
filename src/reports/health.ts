import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { exactPriority, round2 } from "../calculations/priority.js";
import { doneTicketIds } from "../workflow/states.js";

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
  const tickets = await listTickets(db, projectId, { withDescription: false });

  const doneIds = await doneTicketIds(db, projectId);

  let highCount = 0;
  let lowCount = 0;
  let backlogCost = 0;

  for (const t of tickets) {
    if (doneIds.has(t.id)) continue;

    const prio = exactPriority(t);
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
