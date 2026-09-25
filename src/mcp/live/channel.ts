import type { McpServer } from "@modelcontextprotocol/server";
import { DB } from "../../db/connection.js";
import { listProjects } from "../../projects/repository.js";
import { getEventLog, lastEventSequence, type ProjectEvent } from "../../reports/event-log.js";

// Events pushed per project and check; more are summed up in one message
const MAX_CHANNEL_EVENTS = 20;

function describe(project: string, e: ProjectEvent): string {
  const ticket = `"${e.ticketTitle}" in ${project}`;
  const d = e.detail as Record<string, string | number>;
  switch (e.type) {
    case "ticket_created":
      return `New ticket ${ticket} (benefit ${d.benefit}, penalty ${d.penalty}, estimate ${d.estimate}, risk ${d.risk}).`;
    case "ticket_updated":
      return `Ticket ${ticket} was changed.`;
    case "ticket_deleted":
      return `Ticket ${ticket} was deleted.`;
    case "tag_added":
      return `Ticket ${ticket} was tagged ${d.prefix}:${d.value}.`;
    case "tag_removed":
      return `Ticket ${ticket} lost the tag ${d.prefix}:${d.value}.`;
  }
}

/**
 * The Claude Code channel (rw serve --channel): changes to the backlog made
 * elsewhere (the CLI, other sessions) go to the session as
 * notifications/claude/channel messages, one per event.
 */
export class Channel {
  // The last event sequence the channel has seen
  private cursor: number | undefined;
  // Sequences of events this server's own calls wrote: (from, to]
  private ownEvents: Array<[number, number]> = [];

  constructor(private readonly server: McpServer) {}

  // A session hears about changes made elsewhere, not the ones it made itself
  noteOwnEvents = async <T>(db: DB, fn: (db: DB) => Promise<T>): Promise<T> => {
    const from = await lastEventSequence(db);
    try {
      return await fn(db);
    } finally {
      const to = await lastEventSequence(db);
      if (to > from) this.ownEvents.push([from, to]);
    }
  };

  private message(content: string, meta: Record<string, string>) {
    return this.server.server.notification({ method: "notifications/claude/channel", params: { content, meta } });
  }

  async push(db: DB): Promise<void> {
    const last = await lastEventSequence(db);
    // Start from now: the channel reports what happens while it listens
    if (this.cursor === undefined || last <= this.cursor) {
      this.cursor ??= last;
      return;
    }
    const own = (seq: number) => this.ownEvents.some(([from, to]) => seq > from && seq <= to);
    for (const proj of await listProjects(db)) {
      const events = (await getEventLog(db, proj.id, undefined, undefined, this.cursor)).filter((e) => !own(e.sequence));
      for (const e of events.slice(0, MAX_CHANNEL_EVENTS)) {
        await this.message(describe(proj.name, e), { project: proj.name, event: e.type, ticket: e.ticketTitle, sequence: String(e.sequence) });
      }
      if (events.length > MAX_CHANNEL_EVENTS) {
        const more = events.length - MAX_CHANNEL_EVENTS;
        await this.message(`${more} more change${more === 1 ? "" : "s"} in ${proj.name}: see event_log.`, { project: proj.name, event: "more" });
      }
    }
    this.cursor = last;
    this.ownEvents = this.ownEvents.filter(([, to]) => to > last);
  }
}
