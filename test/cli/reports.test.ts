import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";
import { DB } from "../../src/db/connection.js";

describe("rw report (CLI)", () => {
  let dir: string;
  let rw: (...args: string[]) => ReturnType<typeof runCli>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rw-cli-"));
    const db = join(dir, "x.db");
    rw = (...args) => runCli(["--db", db, ...args]);
    rw("project", "create", "P");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("report flow shows throughput, percentiles and the work in progress, in every format", () => {
    rw("ticket", "create", "--project", "P", "--title", "Started");
    rw("ticket", "create", "--project", "P", "--title", "Finished");
    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "Started");
    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "Finished");
    rw("tag", "assign", "state:done", "--project", "P", "--ticket", "Finished");

    const text = rw("report", "flow", "--project", "P", "--weeks", "2").stdout;
    assert.match(text, /Throughput over the last 2 complete weeks: 0 tickets per week/);
    assert.match(text, /1 \(so far\)/);
    assert.match(text, /Cycle time \(1 tickets\): 50% within 0 days/);
    assert.match(text, /In progress \(1\), oldest first:\n  Started: 0 days since/);

    const json = JSON.parse(rw("--json", "report", "flow", "--project", "P").stdout);
    assert.equal(json.weeks, 12);
    assert.equal(json.throughput.length, 13);
    assert.deepEqual(json.inProgress.map((t: { title: string }) => t.title), ["Started"]);

    assert.match(rw("--csv", "report", "flow", "--project", "P").stdout, /^Section,Name,Value\n/);
    assert.match(rw("--quiet", "report", "flow", "--project", "P").stdout, /^in_progress_days\tStarted\t0$/m);
  });

  it("report forecast says there is no pace yet, and forecasts once there is", () => {
    rw("ticket", "create", "--project", "P", "--title", "Open");
    assert.equal(
      rw("report", "forecast", "--project", "P").stdout,
      "No ticket was done in the last 90 days: there is no pace to forecast 1 ticket from.\n"
    );
    assert.match(rw("report", "forecast", "--project", "P", "--history-days", "0").stderr, /must be 1 or greater/);
    const json = JSON.parse(rw("--json", "report", "forecast", "--project", "P", "--items", "0").stdout);
    assert.equal(json.items, 0);
    assert.equal(json.outcomes[0].days, 0);
  });

  it("report group names the prefix it searched for when it finds nothing", () => {
    assert.equal(rw("report", "group", "--project", "P", "--prefix", " Nope ").stdout, 'No tickets with "nope:" tags found.\n');
  });

  it("summary heads the top list with the number of tickets shown", () => {
    rw("ticket", "create", "--project", "P", "--title", "A");
    rw("ticket", "create", "--project", "P", "--title", "B");
    const out = rw("report", "summary", "--project", "P").stdout;
    assert.ok(out.includes("Top 2 open by priority:"), out);
  });

  it("report times --json has a stable shape with both averages", () => {
    rw("ticket", "create", "--project", "P", "--title", "Open");
    const report = JSON.parse(rw("--json", "report", "times", "--project", "P").stdout);
    assert.deepEqual(report, {
      tickets: [{ ticketId: report.tickets[0].ticketId, ticketTitle: "Open", leadTimeDays: null, cycleTimeDays: null }],
      averageLeadTimeDays: null,
      averageCycleTimeDays: null,
    });
  });

  it("report times --csv leaves a missing cycle time empty", () => {
    rw("ticket", "create", "--project", "P", "--title", "Done");
    rw("tag", "assign", "state:done", "--project", "P", "--ticket", "Done");
    assert.equal(rw("--csv", "report", "times", "--project", "P").stdout, "Title,Lead Time,Cycle Time\nDone,0d,\n");
  });

  it("report times lists open tickets in the table and CSV too, as in --json", () => {
    rw("ticket", "create", "--project", "P", "--title", "Done");
    rw("ticket", "create", "--project", "P", "--title", "Open");
    rw("tag", "assign", "state:done", "--project", "P", "--ticket", "Done");
    assert.equal(rw("--csv", "report", "times", "--project", "P").stdout, "Title,Lead Time,Cycle Time\nDone,0d,\nOpen,,\n");
    assert.match(rw("report", "times", "--project", "P").stdout, /Open +\| -/);
  });

  it("report group and report times honour --quiet", () => {
    rw("ticket", "create", "--project", "P", "--title", "Done");
    rw("tag", "assign", "state:done", "--project", "P", "--ticket", "Done");
    assert.equal(rw("--quiet", "report", "group", "--project", "P", "--prefix", "state").stdout, "done\t1\t1.00\n");
    assert.equal(rw("--quiet", "report", "times", "--project", "P").stdout, "Done\t0\t\n");
  });

  it("report summary, report health, project diff and config weights honour --csv and --quiet", () => {
    const since = new Date(Date.now() - 1000).toISOString();
    rw("ticket", "create", "--project", "P", "--title", "A", "--benefit", "3");
    rw("tag", "assign", "state:wip", "--project", "P", "--ticket", "A");
    const out = (...args: string[]) => rw(...args, "--project", "P").stdout;

    assert.equal(out("--csv", "report", "summary"), "Section,Name,Value\ntotal,,1\nstate,wip,1\ntop,A,2.00\n");
    assert.equal(out("--quiet", "report", "summary"), "total\t\t1\nstate\twip\t1\ntop\tA\t2.00\n");
    assert.match(out("--csv", "report", "health"), /^Metric,Value\ntotalTickets,1\n/);
    assert.match(out("--quiet", "report", "health"), /^totalTickets\t1\n/);
    assert.equal(out("--csv", "project", "diff", "--since", since), "Change,Ticket,Detail\nnew,A,2.00\ntag_added,A,state:wip\n");
    assert.equal(out("--quiet", "project", "diff", "--since", since), "new\tA\t2.00\ntag_added\tA\tstate:wip\n");
    assert.equal(out("--quiet", "config", "weights"), "1.5\t1.5\t1.5\t1.5\n");
  });

  it("report health lists the stale tickets, at most 10 in the text, and takes --stale-days", async () => {
    for (let i = 1; i <= 12; i++) rw("ticket", "create", "--project", "P", "--title", `T${String(i).padStart(2, "0")}`);
    rw("ticket", "create", "--project", "P", "--title", "New");
    // Created 100 + i days ago: T01 is the newest of the stale ones
    const db = await DB.open(join(dir, "x.db"));
    for (let i = 1; i <= 12; i++) {
      await db.run("UPDATE tickets SET created_at = ? WHERE title = ?", new Date(Date.now() - (100 + i) * 86_400_000).toISOString(), `T${String(i).padStart(2, "0")}`);
    }
    await db.close();

    const text = rw("report", "health", "--project", "P").stdout;
    assert.match(text, /Not re-scored for 90 days or more: 12\n  T12 \(112 days\)\n/);
    assert.match(text, /  T03 \(103 days\)\n  … and 2 more \(--json lists them all\)/);
    assert.doesNotMatch(text, /New/);
    const json = JSON.parse(rw("--json", "report", "health", "--project", "P", "--stale-days", "110").stdout);
    assert.deepEqual([json.staleDays, json.staleTickets.map((t: any) => t.title)], [110, ["T12", "T11", "T10"]]);
    assert.match(rw("--quiet", "report", "health", "--project", "P").stdout, /\nstaleTickets\t12\n/);
    assert.match(rw("--csv", "report", "health", "--project", "P").stdout, /\nstaleTickets,12\n/);
    assert.equal(rw("report", "health", "--project", "P", "--stale-days", "0").code, 1);
  });

  it("says --limit 0 showed nothing rather than that nothing exists", () => {
    rw("ticket", "create", "--project", "P", "--title", "A");
    rw("ticket", "update", "--project", "P", "--title", "A", "--benefit", "3");
    assert.equal(rw("project", "history", "--project", "P", "--limit", "0").stdout, "No revisions shown (--limit 0).\n");
    assert.equal(rw("report", "event-log", "--project", "P", "--limit", "0").stdout, "No events shown (--limit 0).\n");
  });

  it("prints diff priorities with two decimals and lines up the event log's details", () => {
    const since = new Date(Date.now() - 1000).toISOString();
    rw("ticket", "create", "--project", "P", "--title", "A", "--benefit", "8", "--estimate", "5");
    rw("ticket", "create", "--project", "P", "--title", "Much longer title");
    assert.match(rw("project", "diff", "--project", "P", "--since", since).stdout, /\+ A \(priority: 1\.50\)/);

    const lines = rw("report", "event-log", "--project", "P").stdout.trim().split("\n");
    const detailAt = lines.map((line) => line.indexOf("{"));
    assert.equal(new Set(detailAt).size, 1, lines.join("\n"));
  });
});
