import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";

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

  let doneCount = 0;
  let highCount = 0;
  let lowCount = 0;
  let backlogCost = 0;

  for (const t of tickets) {
    const tags = await getTicketTags(db, t.id);
    const isDone = tags.some((tg) => tg.prefix === "state" && tg.value === "done");
    if (isDone) {
      doneCount++;
      continue;
    }

    const prio = priority(t.benefit, t.penalty, t.estimate, t.risk);
    if (prio >= highThreshold) {
      highCount++;
    } else {
      lowCount++;
    }
    backlogCost += t.estimate + t.risk;
  }

  return {
    totalTickets: tickets.length,
    doneTickets: doneCount,
    openTickets: tickets.length - doneCount,
    highPriorityCount: highCount,
    lowPriorityCount: lowCount,
    highToLowRatio: lowCount > 0 ? Math.round((highCount / lowCount) * 100) / 100 : null,
    totalBacklogCost: backlogCost,
  };
}
