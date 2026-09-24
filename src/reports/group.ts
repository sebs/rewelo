import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getProjectTicketTags } from "../tags/assignment.js";
import { exactPriority, round2 } from "../calculations/priority.js";

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
  const tickets = await listTickets(db, projectId, { withDescription: false });
  const groups: Record<string, { count: number; sumPriority: number }> = {};

  const tagsByTicket = await getProjectTicketTags(db, projectId);
  for (const t of tickets) {
    const tags = tagsByTicket.get(t.id) ?? [];
    const matching = tags.filter((tg) => tg.prefix === prefix);
    const prio = exactPriority(t.benefit, t.penalty, t.estimate, t.risk);

    for (const tag of matching) {
      if (!groups[tag.value]) groups[tag.value] = { count: 0, sumPriority: 0 };
      groups[tag.value].count++;
      groups[tag.value].sumPriority += prio;
    }
  }

  // Sort on the exact average, round (half up) for the result
  return Object.entries(groups)
    .sort(([, a], [, b]) => b.sumPriority / b.count - a.sumPriority / a.count)
    .map(([value, data]) => ({
      value,
      ticketCount: data.count,
      averagePriority: round2(data.sumPriority / data.count),
    }));
}
