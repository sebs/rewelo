import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";

export interface ProjectSummary {
  totalTickets: number;
  byState: Record<string, number>;
  topByPriority: { title: string; priority: number }[];
}

export async function getProjectSummary(
  db: DB,
  projectId: number,
  topN: number = 5
): Promise<ProjectSummary> {
  const tickets = await listTickets(db, projectId);

  const byState: Record<string, number> = {};
  for (const t of tickets) {
    const tags = await getTicketTags(db, t.id);
    const stateTag = tags.find((tg) => tg.prefix === "state");
    const state = stateTag ? stateTag.value : "untagged";
    byState[state] = (byState[state] || 0) + 1;
  }

  const sorted = tickets
    .map((t) => ({
      title: t.title,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
    }))
    .sort((a, b) => b.priority - a.priority);

  return {
    totalTickets: tickets.length,
    byState,
    topByPriority: sorted.slice(0, topN),
  };
}
