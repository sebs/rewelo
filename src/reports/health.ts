import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { cost, exactPriority, round2 } from "../calculations/priority.js";
import { doneTicketIds } from "../workflow/states.js";
import { ValidationError } from "../errors.js";

export interface BacklogHealth {
  totalTickets: number;
  doneTickets: number;
  openTickets: number;
  highPriorityCount: number;
  lowPriorityCount: number;
  highToLowRatio: number | null;
  totalBacklogCost: number;
}

/** The high:low ratio as rw shows it, with why there is none */
export function highToLowRatioText(health: BacklogHealth): string {
  if (health.highToLowRatio !== null) return String(health.highToLowRatio);
  return health.highPriorityCount > 0 ? "n/a (no low-priority tickets)" : "n/a";
}

export async function getBacklogHealth(
  db: DB,
  projectId: number,
  highThreshold: number = 1.5
): Promise<BacklogHealth> {
  // Every priority is over 0: a threshold of 0 or less counts all as high
  if (!(highThreshold > 0) || !Number.isFinite(highThreshold)) {
    throw new ValidationError(`The high priority threshold must be a number greater than 0, got ${highThreshold}`);
  }
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
    backlogCost += cost(t);
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
