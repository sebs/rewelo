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
    assert.ok(out.includes("Top 2 by priority:"), out);
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
});
