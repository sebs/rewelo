import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { getTicketTags } from "../tags/assignment.js";
import { priority } from "../calculations/priority.js";
import { getProjectSummary, ProjectSummary } from "./summary.js";
import { getBacklogHealth, BacklogHealth } from "./health.js";
import { getDistribution, DimensionDistribution } from "./distribution.js";

export interface DashboardTicket {
  id: number;
  title: string;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  value: number;
  cost: number;
  priority: number;
  state: string;
  tags: string[];
}

export interface DashboardRelation {
  sourceId: number;
  sourceTitle: string;
  targetId: number;
  targetTitle: string;
  type: string;
}

export interface DashboardData {
  projectName: string;
  generatedAt: string;
  summary: ProjectSummary;
  health: BacklogHealth;
  distribution: DimensionDistribution[];
  tickets: DashboardTicket[];
  relations: DashboardRelation[];
}

export async function getDashboardData(
  db: DB,
  projectId: number,
  projectName: string
): Promise<DashboardData> {
  const [summary, health, distribution, rawTickets] = await Promise.all([
    getProjectSummary(db, projectId, 10),
    getBacklogHealth(db, projectId),
    getDistribution(db, projectId),
    listTickets(db, projectId),
  ]);

  const tickets: DashboardTicket[] = [];
  for (const t of rawTickets) {
    const tags = await getTicketTags(db, t.id);
    const stateTag = tags.find((tg) => tg.prefix === "state");
    tickets.push({
      id: t.id,
      title: t.title,
      benefit: t.benefit,
      penalty: t.penalty,
      estimate: t.estimate,
      risk: t.risk,
      value: t.benefit + t.penalty,
      cost: t.estimate + t.risk,
      priority: priority(t.benefit, t.penalty, t.estimate, t.risk),
      state: stateTag ? stateTag.value : "untagged",
      tags: tags.map((tg) => `${tg.prefix}:${tg.value}`),
    });
  }

  // Query all relations for this project (deduplicated)
  const relationRows = await db.all<{
    source_id: number;
    target_id: number;
    relation_type: string;
  }>(
    `SELECT source_id, target_id, relation_type
     FROM rw.ticket_relations
     WHERE project_id = ?
     ORDER BY created_at`,
    projectId
  );

  // Build a title lookup from tickets we already have
  const titleMap = new Map<number, string>();
  for (const t of rawTickets) {
    titleMap.set(t.id, t.title);
  }

  // Deduplicate: for asymmetric pairs (A blocks B, B is-blocked-by A) keep only
  // the first row per sorted pair of ticket IDs
  const seen = new Set<string>();
  const relations: DashboardRelation[] = [];
  for (const r of relationRows) {
    const pairKey = [r.source_id, r.target_id].sort((a, b) => a - b).join("-");
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    const sourceTitle = titleMap.get(r.source_id);
    const targetTitle = titleMap.get(r.target_id);
    if (!sourceTitle || !targetTitle) continue;

    relations.push({
      sourceId: r.source_id,
      sourceTitle,
      targetId: r.target_id,
      targetTitle,
      type: r.relation_type,
    });
  }

  return {
    projectName,
    generatedAt: new Date().toISOString(),
    summary,
    health,
    distribution,
    tickets,
    relations,
  };
}
