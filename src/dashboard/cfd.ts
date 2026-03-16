import { DB } from "../db/connection.js";

export interface CFDPoint {
  date: string;
  backlog: number;
  wip: number;
  done: number;
}

/**
 * Build cumulative flow data from ticket_tag_changes.
 * Walks the audit log chronologically and snapshots state counts per day.
 *
 * States are derived from tags with prefix "state":
 *   state:backlog, state:wip, state:done
 *
 * Tickets without any state tag are counted as backlog.
 */
export async function buildCFD(
  db: DB,
  projectId: number,
  sprintTag?: string
): Promise<CFDPoint[]> {
  // Get all tickets (optionally filtered by sprint tag)
  let ticketIds: number[];
  if (sprintTag) {
    const parts = sprintTag.split(":");
    const prefix = parts[0];
    const value = parts.slice(1).join(":");
    const rows = await db.all<{ ticket_id: number }>(
      `SELECT tt.ticket_id FROM rw.ticket_tags tt
       JOIN rw.tags tg ON tg.id = tt.tag_id
       JOIN rw.tickets tk ON tk.id = tt.ticket_id
       WHERE tk.project_id = ? AND tg.prefix = ? AND tg.value = ?`,
      projectId,
      prefix,
      value
    );
    ticketIds = rows.map((r) => r.ticket_id);
  } else {
    const rows = await db.all<{ id: number }>(
      `SELECT id FROM rw.tickets WHERE project_id = ?`,
      projectId
    );
    ticketIds = rows.map((r) => r.id);
  }

  if (ticketIds.length === 0) return [];

  // Get ticket creation dates
  const tickets = await db.all<{ id: number; created_at: string }>(
    `SELECT id, created_at FROM rw.tickets WHERE project_id = ?`,
    projectId
  );
  const ticketCreated = new Map<number, string>();
  for (const t of tickets) {
    const d = typeof t.created_at === "object"
      ? (t.created_at as unknown as Date).toISOString()
      : String(t.created_at);
    ticketCreated.set(t.id, d.slice(0, 10));
  }

  // Get all state tag changes for these tickets
  const placeholders = ticketIds.map(() => "?").join(",");
  const changes = await db.all<{
    ticket_id: number;
    action: string;
    changed_at: string;
    prefix: string;
    value: string;
  }>(
    `SELECT c.ticket_id, c.action, c.changed_at, tg.prefix, tg.value
     FROM rw.ticket_tag_changes c
     JOIN rw.tags tg ON tg.id = c.tag_id
     WHERE c.ticket_id IN (${placeholders}) AND tg.prefix = 'state'
     ORDER BY c.changed_at ASC`,
    ...ticketIds
  );

  // Build timeline: for each ticket, track its current state
  const ticketState = new Map<number, string>(); // ticket_id -> state value
  const ticketSet = new Set(ticketIds);

  // Collect all dates (creation + change dates)
  const dateSet = new Set<string>();
  for (const id of ticketIds) {
    const d = ticketCreated.get(id);
    if (d) dateSet.add(d);
  }
  for (const c of changes) {
    const d = typeof c.changed_at === "object"
      ? (c.changed_at as unknown as Date).toISOString()
      : String(c.changed_at);
    dateSet.add(d.slice(0, 10));
  }

  const sortedDates = [...dateSet].sort();
  if (sortedDates.length === 0) return [];

  // Group changes by date
  const changesByDate = new Map<string, typeof changes>();
  for (const c of changes) {
    const d = typeof c.changed_at === "object"
      ? (c.changed_at as unknown as Date).toISOString()
      : String(c.changed_at);
    const date = d.slice(0, 10);
    if (!changesByDate.has(date)) changesByDate.set(date, []);
    changesByDate.get(date)!.push(c);
  }

  // Walk through dates, apply changes, snapshot
  const points: CFDPoint[] = [];
  const createdByDate = new Map<string, number[]>();
  for (const [id, d] of ticketCreated) {
    if (!ticketSet.has(id)) continue;
    if (!createdByDate.has(d)) createdByDate.set(d, []);
    createdByDate.get(d)!.push(id);
  }

  const activeTickets = new Set<number>();

  for (const date of sortedDates) {
    // Add tickets created on this date
    const created = createdByDate.get(date) ?? [];
    for (const id of created) {
      activeTickets.add(id);
      // Default state: backlog (no state tag yet)
    }

    // Apply state changes for this date
    const dayChanges = changesByDate.get(date) ?? [];
    for (const c of dayChanges) {
      if (!ticketSet.has(c.ticket_id)) continue;
      activeTickets.add(c.ticket_id);
      if (c.action === "added") {
        ticketState.set(c.ticket_id, c.value);
      } else if (c.action === "removed") {
        // If the removed state matches current, revert to backlog
        if (ticketState.get(c.ticket_id) === c.value) {
          ticketState.delete(c.ticket_id);
        }
      }
    }

    // Snapshot counts
    let backlog = 0;
    let wip = 0;
    let done = 0;
    for (const id of activeTickets) {
      const state = ticketState.get(id) ?? "backlog";
      if (state === "done") done++;
      else if (state === "wip") wip++;
      else backlog++;
    }

    points.push({ date, backlog, wip, done });
  }

  return points;
}
