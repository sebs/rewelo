import { DB } from "../db/connection.js";

export interface ProjectEvent {
  timestamp: string;
  type: "ticket_created" | "ticket_updated" | "tag_added" | "tag_removed";
  ticketId: number;
  ticketTitle: string;
  detail: Record<string, unknown>;
}

export async function getEventLog(
  db: DB,
  projectId: number,
  since?: string,
  limit?: number
): Promise<ProjectEvent[]> {
  const params: unknown[] = [projectId];
  let sinceClause = "";
  if (since) {
    sinceClause = " AND ts >= ?";
    params.push(since);
  }

  // Union three event sources into one chronological stream:
  // 1. Ticket creations (from tickets table)
  // 2. Score/title changes (from ticket_revisions — the revision is the BEFORE snapshot)
  // 3. Tag changes (from ticket_tag_changes)
  const sql = `
    SELECT * FROM (
      SELECT
        t.created_at AS ts,
        'ticket_created' AS type,
        t.id AS ticket_id,
        t.title AS ticket_title,
        json_object('benefit', t.benefit, 'penalty', t.penalty,
                     'estimate', t.estimate, 'risk', t.risk) AS detail
      FROM rw.tickets t
      WHERE t.project_id = ?${sinceClause}

      UNION ALL

      SELECT
        r.revised_at AS ts,
        'ticket_updated' AS type,
        r.ticket_id,
        t.title AS ticket_title,
        json_object('prev_title', r.title,
                     'prev_benefit', r.benefit, 'prev_penalty', r.penalty,
                     'prev_estimate', r.estimate, 'prev_risk', r.risk) AS detail
      FROM rw.ticket_revisions r
      JOIN rw.tickets t ON t.id = r.ticket_id
      WHERE t.project_id = ?${sinceClause.replace("ts", "r.revised_at")}

      UNION ALL

      SELECT
        c.changed_at AS ts,
        CASE WHEN c.action = 'added' THEN 'tag_added' ELSE 'tag_removed' END AS type,
        c.ticket_id,
        t.title AS ticket_title,
        json_object('prefix', tg.prefix, 'value', tg.value) AS detail
      FROM rw.ticket_tag_changes c
      JOIN rw.tickets t ON t.id = c.ticket_id
      JOIN rw.tags tg ON tg.id = c.tag_id
      WHERE t.project_id = ?${sinceClause.replace("ts", "c.changed_at")}
    ) events
    ORDER BY ts DESC, ticket_id
  `;

  // Add projectId for each UNION branch
  params.push(projectId);
  if (since) params.push(since);
  params.push(projectId);
  if (since) params.push(since);

  if (limit) {
    params.push(limit);
  }

  const limitClause = limit ? " LIMIT ?" : "";

  const rows = await db.all<{
    ts: string;
    type: string;
    ticket_id: number;
    ticket_title: string;
    detail: string;
  }>(sql + limitClause, ...params);

  return rows.map((r) => ({
    timestamp: typeof r.ts === "object" ? (r.ts as Date).toISOString() : String(r.ts),
    type: r.type as ProjectEvent["type"],
    ticketId: r.ticket_id,
    ticketTitle: r.ticket_title,
    detail: typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail,
  }));
}
