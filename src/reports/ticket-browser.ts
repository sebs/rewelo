import { DB } from "../db/connection.js";
import type { Ticket } from "../tickets/repository.js";
import { cost, priority, value } from "../calculations/priority.js";
import { getProjectTicketTags } from "../tags/assignment.js";
import { getRelationType } from "../relations/types.js";
import { STATE_PREFIX } from "../workflow/states.js";
import { esc } from "./html.js";
import { truncate } from "../text.js";
import type { ProjectRelationView } from "../relations/repository.js";

// The dashboard's ticket browser: every ticket, done ones too, in a dialog
// that a button opens, filtered by state, a page at a time, each with its
// details in a dialog of its own. Like the rest of the dashboard it runs
// without a script, which the MCP App page would not run: the buttons open
// the dialogs (invoker commands), and the filter and the pages are radio
// buttons that :has() follows. A list per state holds its own pages, so a
// ticket is listed twice (under All and its state), its details once.

/** Tickets on a page of the browser */
export const BROWSER_PAGE_SIZE = 20;

/**
 * The most tickets the browser lists, whatever the dashboard's limit: each
 * takes about three times a table row (a row under All, one under its state,
 * its details), and 12,000 made a dashboard of 35 MB
 */
export const BROWSER_MAX_TICKETS = 500;

/** Characters of a description shown in its details; up to 10,000 are stored */
export const BROWSER_DESCRIPTION = 2000;

export interface BrowserTicket {
  id: number;
  title: string;
  description: string | null;
  benefit: number;
  penalty: number;
  estimate: number;
  risk: number;
  value: number;
  cost: number;
  priority: number;
  /** The value of its state tag (state:wip is "wip"), if it has one */
  state: string | null;
  /** Its tags as prefix:value */
  tags: string[];
  /** Its relations as read from it: "blocks" the other ticket, or "is-blocked-by" it */
  relations: Array<{ type: string; other: string; otherDone: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export interface TicketBrowser {
  /** The tickets listed: the highest priority first, at most the dashboard's limit and BROWSER_MAX_TICKETS */
  tickets: BrowserTicket[];
  /** Tickets in the project */
  total: number;
}

/**
 * The browser's tickets; ranked is every ticket, highest priority first.
 * Descriptions are read only for the tickets listed: all of them, for a
 * large project, ran the heap out of memory.
 */
export async function getTicketBrowser(
  db: DB,
  projectId: number,
  ranked: Ticket[],
  relations: ProjectRelationView[],
  done: Set<number>,
  limit: number
): Promise<TicketBrowser> {
  const listed = ranked.slice(0, Math.min(limit, BROWSER_MAX_TICKETS));
  const descriptions = new Map(
    (await db.all<{ id: number; description: string | null }>(
      `SELECT id, description FROM tickets WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(listed.map((t) => t.id))
    )).map((r) => [r.id, r.description])
  );
  const tags = await getProjectTicketTags(db, projectId);
  const titles = new Map(ranked.map((t) => [t.id, t.title]));
  const related = new Map<number, BrowserTicket["relations"]>();
  const add = (id: number, relation: BrowserTicket["relations"][number]) => {
    const list = related.get(id);
    if (list) list.push(relation);
    else related.set(id, [relation]);
  };
  for (const r of relations) {
    const type = getRelationType(r.relation_type);
    add(r.source_id, { type: type.forward, other: titles.get(r.target_id) ?? r.target_title, otherDone: done.has(r.target_id) });
    add(r.target_id, { type: type.inverse, other: titles.get(r.source_id) ?? r.source_title, otherDone: done.has(r.source_id) });
  }
  return {
    tickets: listed.map((t) => {
      const own = tags.get(t.id) ?? [];
      return {
        id: t.id,
        title: t.title,
        description: descriptions.get(t.id) ?? null,
        benefit: t.benefit,
        penalty: t.penalty,
        estimate: t.estimate,
        risk: t.risk,
        value: value(t),
        cost: cost(t),
        priority: priority(t),
        state: own.find((tag) => tag.prefix === STATE_PREFIX)?.value ?? null,
        tags: own.map((tag) => `${tag.prefix}:${tag.value}`),
        relations: related.get(t.id) ?? [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      };
    }),
    total: ranked.length,
  };
}

/** The dialog that lists a ticket's details */
const detailId = (id: number) => `ticket-${id}`;
export const BROWSER_ID = "ticket-browser";

/** A list of the browser: All, a state, or the tickets without one */
interface BrowserList {
  name: string;
  tickets: BrowserTicket[];
}

function browserLists(tickets: BrowserTicket[]): BrowserList[] {
  const states = [...new Set(tickets.map((t) => t.state).filter((s): s is string => s !== null))].sort();
  const lists = [
    { name: "All", tickets },
    ...states.map((s) => ({ name: s, tickets: tickets.filter((t) => t.state === s) })),
  ];
  const without = tickets.filter((t) => t.state === null);
  // "No state" only beside other states: alone, it would repeat All
  return states.length > 0 && without.length > 0 ? [...lists, { name: "No state", tickets: without }] : lists;
}

const pages = (n: number) => Math.max(1, Math.ceil(n / BROWSER_PAGE_SIZE));

/** The CSS that shows the checked list and page: a rule per list and per page number */
export function browserCss(browser: TicketBrowser): string {
  const lists = browserLists(browser.tickets);
  const mostPages = Math.max(1, ...lists.map((l) => pages(l.tickets.length)));
  return [
    `.browser-list, .browser .page { display: none; }`,
    `.browser .list-0 { display: block; }`,
    `.browser:has(.state-filter input:checked:not(#browser-state-0)) .list-0 { display: none; }`,
    ...lists.slice(1).map((_, i) => `.browser:has(#browser-state-${i + 1}:checked) .list-${i + 1} { display: block; }`),
    `.browser .page-1 { display: table-row-group; }`,
    `.browser-list:has(.pager input:checked:not([value="1"])) .page-1 { display: none; }`,
    ...Array.from({ length: mostPages - 1 }, (_, i) => i + 2).map(
      (n) => `.browser-list:has(.pager input[value="${n}"]:checked) .page-${n} { display: table-row-group; }`
    ),
  ].join("\n  ");
}

const stateBadge = (state: string | null) => (state === null ? "" : `<span class="badge">${esc(state)}</span>`);

function row(t: BrowserTicket): string {
  return `<tr><td><button type="button" class="link" commandfor="${detailId(t.id)}" command="show-modal">${esc(t.title)}</button></td><td>${stateBadge(t.state)}</td><td class="n">${t.benefit}</td><td class="n">${t.penalty}</td><td class="n">${t.estimate}</td><td class="n">${t.risk}</td><td class="n">${t.value}</td><td class="n">${t.cost}</td><td class="n strong">${t.priority.toFixed(2)}</td></tr>`;
}

function listHtml(list: BrowserList, k: number): string {
  const count = pages(list.tickets.length);
  const bodies = Array.from(
    { length: count },
    (_, p) => `<tbody class="page page-${p + 1}">${list.tickets.slice(p * BROWSER_PAGE_SIZE, (p + 1) * BROWSER_PAGE_SIZE).map(row).join("")}</tbody>`
  ).join("");
  const pager =
    count > 1
      ? `<fieldset class="window pager"><legend>Page</legend>${Array.from({ length: count }, (_, p) => {
          const id = `browser-page-${k}-${p + 1}`;
          return `<input type="radio" name="browser-page-${k}" id="${id}" value="${p + 1}"${p === 0 ? " checked" : ""}><label for="${id}">${p + 1}</label>`;
        }).join("")}</fieldset>`
      : "";
  return `<div class="browser-list list-${k}">
    <div class="scroll">
    <table aria-label="${esc(`Tickets: ${list.name}`)}">
      <thead><tr><th scope="col">Title</th><th scope="col">State</th><th scope="col"><abbr title="Benefit">B</abbr></th><th scope="col"><abbr title="Penalty">P</abbr></th><th scope="col"><abbr title="Estimate">E</abbr></th><th scope="col"><abbr title="Risk">R</abbr></th><th scope="col">Value</th><th scope="col">Cost</th><th scope="col">Priority</th></tr></thead>
      ${bodies}
    </table>
    </div>
    ${pager}
  </div>`;
}

function detailHtml(t: BrowserTicket): string {
  const id = detailId(t.id);
  const scores = (
    [
      ["Benefit", t.benefit],
      ["Penalty", t.penalty],
      ["Estimate", t.estimate],
      ["Risk", t.risk],
      ["Value", t.value],
      ["Cost", t.cost],
      ["Priority", t.priority.toFixed(2)],
    ] as const
  )
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("");
  const shown = t.description && truncate(t.description, BROWSER_DESCRIPTION);
  const description = !t.description
    ? `<p class="empty">No description.</p>`
    : shown === t.description
      ? `<p class="desc">${esc(t.description)}</p>`
      : `<p class="desc">${esc(shown!)}…</p><p class="meta">The first ${BROWSER_DESCRIPTION.toLocaleString("en")} characters; an export (<code>rw export</code>, <code>export_json</code>) has all of it.</p>`;
  const tags = t.tags.length > 0 ? `<ul class="tags">${t.tags.map((tag) => `<li class="badge">${esc(tag)}</li>`).join("")}</ul>` : `<p class="empty">No tags.</p>`;
  const relations =
    t.relations.length > 0
      ? `<ul class="related">${t.relations
          .map((r) => `<li><span class="muted">${esc(r.type)}</span> ${esc(r.other)}${r.otherDone ? ` <span class="badge">done</span>` : ""}</li>`)
          .join("")}</ul>`
      : `<p class="empty">No relations.</p>`;
  return `<dialog id="${id}" class="ticket-detail" closedby="any" aria-labelledby="${id}-title">
  <div class="dialog-head"><h2 id="${id}-title">${esc(t.title)}</h2><button type="button" class="close" commandfor="${id}" command="close" aria-label="Close">×</button></div>
  <dl class="scores">${scores}</dl>
  <h3>Description</h3>
  ${description}
  <h3>Tags</h3>
  ${tags}
  <h3>Relations</h3>
  ${relations}
  <p class="meta">Created ${esc(t.createdAt)} · updated ${esc(t.updatedAt)}</p>
</dialog>`;
}

/** The button that opens the browser */
export function browserButton(): string {
  return `<button type="button" class="open-browser" commandfor="${BROWSER_ID}" command="show-modal">Browse all tickets</button>`;
}

/**
 * The browser's dialog and the tickets' detail dialogs; more says how the
 * reader raises the dashboard's limit when it left tickets out
 */
export function browserHtml(browser: TicketBrowser, more: string): string {
  const lists = browserLists(browser.tickets);
  const filter = lists
    .map((l, k) => {
      const id = `browser-state-${k}`;
      return `<input type="radio" name="browser-state" id="${id}"${k === 0 ? " checked" : ""}><label for="${id}">${esc(l.name)} <span class="count">${l.tickets.length}</span></label>`;
    })
    .join("");
  return `<dialog id="${BROWSER_ID}" class="browser" closedby="any" aria-labelledby="browser-title">
  <div class="dialog-head"><h2 id="browser-title">All tickets</h2><button type="button" class="close" commandfor="${BROWSER_ID}" command="close" aria-label="Close">×</button></div>
  <p class="meta">Every ticket, done ones too, highest priority first. Choose one for its details.</p>
  <fieldset class="window state-filter"><legend>State</legend>${filter}</fieldset>
  ${lists.map(listHtml).join("\n  ")}
  ${browser.tickets.length === BROWSER_MAX_TICKETS && browser.total > BROWSER_MAX_TICKETS
    ? `<p class="meta">Showing the ${BROWSER_MAX_TICKETS} highest-priority of ${browser.total} tickets; <code>rw ticket list</code> or <code>ticket_list</code> lists them all.</p>`
    : more}
</dialog>
${browser.tickets.map(detailHtml).join("\n")}`;
}
