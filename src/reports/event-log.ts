import { DB } from "../db/connection.js";
import { normalizeSince } from "../validation/timestamps.js";

export interface ProjectEvent {
  timestamp: string;
  type: "ticket_created" | "ticket_updated" | "ticket_deleted" | "tag_added" | "tag_removed";
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
  // An empty since is invalid (as in project diff), not "no filter"
  if (since !== undefined) since = normalizeSince(since);
  const params: unknown[] = [projectId];
  let sinceClause = "";
  if (since !== undefined) {
    sinceClause = " AND ts >= ?";
    params.push(since);
  }

  // Union four event sources into one chronological stream:
  // 1. Ticket creations (from tickets table)
  // 2. Score/title changes (from ticket_revisions — the revision is the BEFORE snapshot)
  // 3. Tag changes (from ticket_tag_changes)
  // 4. Ticket deletions (from ticket_deletions; the ticket's own history is
  //    deleted with it, so this is the only trace it leaves)
  const sql = `
    SELECT * FROM (
      SELECT
        t.created_at AS ts,
        'ticket_created' AS type,
        t.id AS ticket_id,
        t.title AS ticket_title,
        -- Scores at creation: revisions hold the state *before* each update,
        -- so the earliest revision (if any) is what the ticket started with
        json_object('benefit', coalesce(first.benefit, t.benefit),
                     'penalty', coalesce(first.penalty, t.penalty),
                     'estimate', coalesce(first.estimate, t.estimate),
                     'risk', coalesce(first.risk, t.risk)) AS detail
      FROM tickets t
      LEFT JOIN ticket_revisions first
        ON first.id = (SELECT min(id) FROM ticket_revisions WHERE ticket_id = t.id)
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
      FROM ticket_revisions r
      JOIN tickets t ON t.id = r.ticket_id
      WHERE t.project_id = ?${sinceClause.replace("ts", "r.revised_at")}

      UNION ALL

      SELECT
        c.changed_at AS ts,
        CASE WHEN c.action = 'added' THEN 'tag_added' ELSE 'tag_removed' END AS type,
        c.ticket_id,
        t.title AS ticket_title,
        json_object('prefix', c.prefix, 'value', c.value) AS detail
      FROM ticket_tag_changes c
      JOIN tickets t ON t.id = c.ticket_id
      WHERE t.project_id = ?${sinceClause.replace("ts", "c.changed_at")}

      UNION ALL

      SELECT
        d.deleted_at AS ts,
        'ticket_deleted' AS type,
        d.ticket_id,
        d.title AS ticket_title,
        json_object() AS detail
      FROM ticket_deletions d
      WHERE d.project_id = ?${sinceClause.replace("ts", "d.deleted_at")}
    ) events
    ORDER BY ts DESC, ticket_id DESC
  `;

  // Add projectId for each UNION branch
  for (let branch = 1; branch < 4; branch++) {
    params.push(projectId);
    if (since !== undefined) params.push(since);
  }

  if (limit !== undefined) {
    params.push(limit);
  }

  const limitClause = limit !== undefined ? " LIMIT ?" : "";

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
