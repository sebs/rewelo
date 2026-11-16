import { DB } from "../db/connection.js";
import { exactPriority, priority } from "../calculations/priority.js";
import { DIMENSIONS, type Scores } from "../domain/scores.js";
import { normalizeSince } from "../validation/timestamps.js";
import { doneTicketIds, STATE_PREFIX, DONE } from "../workflow/states.js";

// What changed in the ranking since a date, and why: the open tickets by
// priority (value / cost, as the dashboard and rw report summary rank)
// then and now, and per ticket what of its own changed. A ticket that only
// moved because others did is counted, not listed: a new ticket at the top
// shifts every other one down, and listing them all would hide the change.
//
// The state then comes from the history: the scores from the earliest
// revision after the date (it holds the scores before that change), done
// from the tag change log (the tag now called state:done, as in
// workflow/states.ts), blockers from when the relations were created.
// What the history doesn't keep can't explain a move: the weights (and
// this ranking doesn't use them), relations removed since, and the scores
// of deleted tickets, which are listed by title only.

export const DEFAULT_CHANGE_DAYS = 7;

export interface RankingChange {
  ticketId: number;
  title: string;
  /** Place among the open tickets then and now, from 1; null when it wasn't (or isn't) open */
  rankThen: number | null;
  rankNow: number | null;
  priorityThen: number | null;
  priorityNow: number | null;
  /** What of its own changed, in words */
  reasons: string[];
}

export interface RankingChanges {
  since: string;
  now: string;
  /** Open tickets then (of those that still exist) and now */
  openThen: number;
  openNow: number;
  /** The tickets with a change of their own, by rank now, then the ones done since */
  changes: RankingChange[];
  /** Tickets whose rank changed only because others moved */
  shifted: number;
  /** Tickets deleted since that existed then */
  deleted: string[];
}

interface Row extends Scores {
  id: number;
  title: string;
  created_at: string;
}

/** Highest priority first, ties by age, so a rank is the same every time */
const ranking = (tickets: Row[]) =>
  new Map([...tickets].sort((a, b) => exactPriority(b) - exactPriority(a) || a.id - b.id).map((t, i) => [t.id, i + 1]));

export async function getRankingChanges(db: DB, projectId: number, since?: string, now: Date = new Date()): Promise<RankingChanges> {
  const sinceUtc = since === undefined ? new Date(now.getTime() - DEFAULT_CHANGE_DAYS * 86_400_000).toISOString() : normalizeSince(since);
  const at = (iso: string) => new Date(iso).getTime();
  const sinceMs = at(sinceUtc);

  const tickets = await db.all<Row>(
    "SELECT id, title, created_at, benefit, penalty, estimate, risk FROM tickets WHERE project_id = ?",
    projectId
  );
  const byId = new Map(tickets.map((t) => [t.id, t]));

  // The scores at since: the earliest revision after it holds them
  const scoresThen = new Map<number, Scores>(
    (await db.all<Scores & { ticket_id: number }>(
      `SELECT r.ticket_id, r.benefit, r.penalty, r.estimate, r.risk FROM ticket_revisions r
       JOIN (SELECT ticket_id, min(id) AS id FROM ticket_revisions
             WHERE revised_at > ? AND ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)
             GROUP BY ticket_id) first ON first.id = r.id`,
      sinceUtc,
      projectId
    )).map((r) => [r.ticket_id, { benefit: r.benefit, penalty: r.penalty, estimate: r.estimate, risk: r.risk }])
  );

  // Done at since: the last change of the done tag up to then added it
  const doneThen = new Set<number>();
  for (const c of await db.all<{ ticket_id: number; action: string }>(
    `SELECT c.ticket_id, c.action FROM ticket_tag_changes c
     JOIN tags t ON t.id = c.tag_id AND t.project_id = ? AND t.prefix = '${STATE_PREFIX}' AND t.value = '${DONE}'
     WHERE c.changed_at <= ? ORDER BY c.changed_at, c.id`,
    projectId,
    sinceUtc
  )) {
    if (c.action === "added") doneThen.add(c.ticket_id);
    else doneThen.delete(c.ticket_id);
  }
  const doneNow = await doneTicketIds(db, projectId);

  const existedThen = (t: Row) => at(t.created_at) <= sinceMs;
  const then = tickets.filter((t) => existedThen(t) && !doneThen.has(t.id)).map((t) => ({ ...t, ...(scoresThen.get(t.id) ?? {}) }));
  const current = tickets.filter((t) => !doneNow.has(t.id));
  const rankThen = ranking(then);
  const rankNow = ranking(current);
  const thenById = new Map(then.map((t) => [t.id, t]));

  // Blocking relations (as in relations/blocking.ts), with when they were made
  const blocking = (
    await db.all<{ blocked: number; blocker: number; created_at: string }>(
      `SELECT CASE relation_type WHEN 'blocks' THEN target_id ELSE source_id END AS blocked,
              CASE relation_type WHEN 'blocks' THEN source_id ELSE target_id END AS blocker, created_at
       FROM ticket_relations WHERE project_id = ? AND relation_type IN ('blocks', 'depends-on')`,
      projectId
    )
  ).filter((r) => byId.has(r.blocker) && byId.has(r.blocked));
  // Per blocked ticket: a scan of every relation per ticket was quadratic
  const blockersOf = new Map<number, typeof blocking>();
  for (const r of blocking) {
    const list = blockersOf.get(r.blocked);
    if (list) list.push(r);
    else blockersOf.set(r.blocked, [r]);
  }

  const changes: RankingChange[] = [];
  let shifted = 0;
  for (const id of new Set([...rankThen.keys(), ...rankNow.keys()])) {
    const t = byId.get(id)!;
    const was = thenById.get(id);
    const reasons: string[] = [];
    if (!existedThen(t)) reasons.push("new");
    else if (!was && rankNow.has(id)) reasons.push("reopened");
    if (was && !rankNow.has(id)) reasons.push("done");
    if (was && rankNow.has(id)) {
      const rescored = DIMENSIONS.filter((d) => was[d] !== t[d]).map((d) => `${d} ${was[d]} → ${t[d]}`);
      if (rescored.length > 0) reasons.push(`re-scored: ${rescored.join(", ")}`);
    }
    if (rankNow.has(id)) {
      for (const r of blockersOf.get(id) ?? []) {
        const blocker = byId.get(r.blocker)!;
        if (!doneNow.has(r.blocker)) {
          if (at(r.created_at) > sinceMs) reasons.push(`now blocked by ${blocker.title}`);
        } else if (at(r.created_at) <= sinceMs && existedThen(blocker) && !doneThen.has(blocker.id)) {
          reasons.push(`no longer blocked: ${blocker.title} is done`);
        }
      }
    }
    const moved = rankThen.get(id) !== rankNow.get(id);
    if (reasons.length === 0) {
      if (moved) shifted++;
      continue;
    }
    changes.push({
      ticketId: id,
      title: t.title,
      rankThen: rankThen.get(id) ?? null,
      rankNow: rankNow.get(id) ?? null,
      priorityThen: was ? priority(was) : null,
      priorityNow: rankNow.has(id) ? priority(t) : null,
      reasons,
    });
  }
  changes.sort((a, b) => (a.rankNow ?? Infinity) - (b.rankNow ?? Infinity) || (a.rankThen ?? 0) - (b.rankThen ?? 0));

  const deleted = (
    await db.all<{ title: string }>(
      "SELECT title FROM ticket_deletions WHERE project_id = ? AND deleted_at > ? AND (created_at IS NULL OR created_at <= ?) ORDER BY deleted_at",
      projectId,
      sinceUtc,
      sinceUtc
    )
  ).map((d) => d.title);

  return { since: sinceUtc, now: now.toISOString(), openThen: then.length, openNow: current.length, changes, shifted, deleted };
}

/** "#4 → #1", "new at #3", "reopened at #5", "#2 → done" */
export function rankMove(c: RankingChange): string {
  if (c.rankThen === null && c.rankNow !== null) return `${c.reasons.includes("reopened") ? "reopened" : "new"} at #${c.rankNow}`;
  if (c.rankNow === null) return `#${c.rankThen} → done`;
  return c.rankThen === c.rankNow ? `#${c.rankNow}` : `#${c.rankThen} → #${c.rankNow}`;
}
