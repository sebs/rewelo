import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";

export interface TagGroup {
  value: string;
  ticketCount: number;
  averagePriority: number;
}

export async function groupByTagPrefix(
  db: DB,
  projectId: number,
  prefix: string
): Promise<TagGroup[]> {
  const tickets = await listTickets(db, projectId);
  const groups: Record<string, { count: number; sumPriority: number }> = {};

  for (const t of tickets) {
    const tags = await getTicketTags(db, t.id);
    const matching = tags.filter((tg) => tg.prefix === prefix);
    const prio = priority(t.benefit, t.penalty, t.estimate, t.risk);

    for (const tag of matching) {
      if (!groups[tag.value]) groups[tag.value] = { count: 0, sumPriority: 0 };
      groups[tag.value].count++;
      groups[tag.value].sumPriority += prio;
    }
  }

  return Object.entries(groups)
    .map(([value, data]) => ({
      value,
      ticketCount: data.count,
      averagePriority: Math.round((data.sumPriority / data.count) * 100) / 100,
    }))
    .sort((a, b) => b.averagePriority - a.averagePriority);
}
