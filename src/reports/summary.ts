import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getProjectTicketTags } from "../tags/assignment.js";
import { byPriority, priority } from "../calculations/priority.js";
import { doneTicketIds } from "./health.js";

export interface ProjectSummary {
  totalTickets: number;
  byState: Record<string, number>;
  /** Tickets without any state tag (kept apart from a real state:untagged tag) */
  withoutState: number;
  topByPriority: { title: string; priority: number }[];
}

export async function getProjectSummary(
  db: DB,
  projectId: number,
  topN: number = 5
): Promise<ProjectSummary> {
  const tickets = await listTickets(db, projectId, { withDescription: false });

  const byState: Record<string, number> = {};
  let withoutState = 0;
  const tagsByTicket = await getProjectTicketTags(db, projectId);
  for (const t of tickets) {
    const tags = tagsByTicket.get(t.id) ?? [];
    const stateTag = tags.find((tg) => tg.prefix === "state");
    if (stateTag) byState[stateTag.value] = (byState[stateTag.value] || 0) + 1;
    else withoutState++;
  }

  // The top list is what to do next: open tickets only, as report health counts
  const done = await doneTicketIds(db, projectId);
  const sorted = tickets
    .filter((t) => !done.has(t.id))
    .sort(byPriority)
    .map((t) => ({
      title: t.title,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
    }));

  return {
    totalTickets: tickets.length,
    byState,
    withoutState,
    topByPriority: sorted.slice(0, topN),
  };
}
