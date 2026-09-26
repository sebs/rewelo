import type { McpServer } from "@modelcontextprotocol/server";
import type { DB } from "../../db/connection.js";
import { AppError, sanitizeError } from "../../errors.js";
import { shorten } from "../results.js";
import type { DbSession } from "../session.js";
import type { Channel } from "./channel.js";

const MAX_SUBSCRIPTIONS = 1000;

/**
 * Other processes (the CLI, other sessions' servers) write to the same
 * database without this server seeing it: look for changes every so often,
 * but only while something is subscribed or the channel is on. Subscribers
 * get notifications/resources/updated; the channel, if any, its events.
 */
export class ChangeWatcher {
  private readonly subscriptions = new Set<string>();
  // This session committed a write since the last check
  private wrote = false;
  // PRAGMA data_version: changes when another connection commits
  private dataVersion: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;

  constructor(
    private readonly server: McpServer,
    private readonly session: DbSession,
    private readonly channel: Channel | undefined,
    private readonly pollIntervalMs: number
  ) {}

  // PRAGMA data_version doesn't change for this connection's own commits:
  // its write transactions say when they commit, and subscribers hear of it
  // on the next check. A dry run or a failed call commits nothing, and a
  // transaction that changed no row (an update to the same scores, an
  // empty import) is no news either.
  attach(db: DB): void {
    let before = 0;
    void this.noteProjects(db);
    db.observeTransactions({
      begun: async () => void (before = await db.totalChanges()),
      committing: async () => {
        if ((await db.totalChanges()) === before) return;
        this.wrote = true;
        await this.noteProjects(db);
      },
    });
  }

  // The resource list has a backlog and a dashboard per project: clients
  // hear when the projects change (the server has the listChanged
  // capability), by this session's writes or, while it watches, others'
  private projects: string | undefined;

  private async noteProjects(db: DB): Promise<void> {
    const [{ ids }] = await db.all<{ ids: string | null }>("SELECT group_concat(id) AS ids FROM (SELECT id FROM projects ORDER BY id)");
    const changed = this.projects !== undefined && (ids ?? "") !== this.projects;
    this.projects = ids ?? "";
    if (changed && this.server.isConnected()) this.server.sendResourceListChanged();
  }

  /** Handle resources/subscribe and resources/unsubscribe */
  handleSubscriptions(): void {
    this.server.server.setRequestHandler("resources/subscribe", async (request) => {
      const { uri } = request.params;
      if (!uri.startsWith("rewelo://")) throw new AppError(`Can't subscribe to ${shorten(uri)}: rewelo's resources start with rewelo://`);
      if (!this.subscriptions.has(uri) && this.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new AppError(`At most ${MAX_SUBSCRIPTIONS} subscriptions`);
      this.subscriptions.add(uri);
      this.watch();
      return {};
    });

    this.server.server.setRequestHandler("resources/unsubscribe", async (request) => {
      this.subscriptions.delete(request.params.uri);
      this.unwatch();
      return {};
    });
  }

  private async check() {
    if (this.checking) return; // the previous check is still running
    this.checking = true;
    try {
      await this.session.queued(async (db) => {
        const version = await db.dataVersion();
        await this.noteProjects(db);
        const changed = this.wrote || (this.dataVersion !== undefined && version !== this.dataVersion);
        this.dataVersion = version;
        this.wrote = false;
        if (changed) for (const uri of this.subscriptions) await this.server.server.sendResourceUpdated({ uri });
        if (this.channel) await this.channel.push(db);
      });
    } catch (err) {
      // Checked again on the next tick; say why on stderr, which is free
      console.error(`rewelo: looking for changes failed: ${sanitizeError(err)}`);
    } finally {
      this.checking = false;
    }
  }

  /** Start looking for changes, if anyone listens and it isn't already */
  watch(): void {
    if (this.timer || !(this.channel || this.subscriptions.size > 0)) return;
    // Writes before anyone listened are no news; the first check notes the
    // state to compare the next ones with
    this.wrote = false;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.pollIntervalMs);
    this.timer.unref();
  }

  private unwatch(): void {
    if (this.timer && !this.channel && this.subscriptions.size === 0) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
