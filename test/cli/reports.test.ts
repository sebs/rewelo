import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./run.js";

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
