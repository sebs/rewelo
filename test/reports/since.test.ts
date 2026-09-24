import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { listProjectRevisions } from "../../src/revisions/repository.js";
import { getEventLog } from "../../src/reports/event-log.js";
import { getProjectDiff } from "../../src/reports/diff.js";
import { ValidationError } from "../../src/validation/strings.js";

// The same instant written in UTC and with a +02:00 offset. Timestamps are
// stored as UTC text, so a raw string comparison gets the offset form wrong.
function sinceBoth(msAgo: number): { utc: string; offset: string } {
  const ms = Date.now() - msAgo;
  return {
    utc: new Date(ms).toISOString(),
    offset: new Date(ms + 2 * 3600_000).toISOString().replace("Z", "+02:00"),
  };
}

describe("since filters", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Since")).id;
    const t = await createTicket(db, { projectId, title: "A", benefit: 8 });
    await updateTicket(db, projectId, t.id, { benefit: 13 });
    await assignTag(db, t.id, (await createTag(db, projectId, "state", "wip")).id);
  });

  afterEach(async () => {
    await db.close();
  });

  const { utc, offset } = sinceBoth(3600_000);

  it("event log treats an offset timestamp like the same instant in UTC", async () => {
    const expected = await getEventLog(db, projectId, utc);
    assert.equal(expected.length, 3);
    assert.deepEqual(await getEventLog(db, projectId, offset), expected);
  });

  it("project history treats an offset timestamp like the same instant in UTC", async () => {
    const expected = await listProjectRevisions(db, projectId, utc);
    assert.equal(expected.length, 1);
    assert.deepEqual(await listProjectRevisions(db, projectId, offset), expected);
  });

  it("project diff treats an offset timestamp like the same instant in UTC", async () => {
    const expected = await getProjectDiff(db, projectId, utc);
    assert.equal(expected.newTickets.length, 1);
    assert.equal(expected.tagChanges.length, 1);
    const actual = await getProjectDiff(db, projectId, offset);
    assert.deepEqual({ ...actual, since: utc, now: expected.now }, expected);
  });

  it("project history returns no revisions for limit 0", async () => {
    assert.deepEqual(await listProjectRevisions(db, projectId, undefined, 0), []);
  });

  it("rejects a since value that is not a timestamp", async () => {
    await assert.rejects(getEventLog(db, projectId, "garbage"), /Invalid timestamp "garbage"/);
    await assert.rejects(listProjectRevisions(db, projectId, "yesterday"), /Invalid timestamp/);
    await assert.rejects(getProjectDiff(db, projectId, "garbage"), ValidationError);
  });

  it("rejects values Date.parse would guess at, such as free text and impossible dates", async () => {
    for (const since of ["Ticket 12", "1", "2026-02-30", "2026-13-01", "2026-03-10T25:00"]) {
      await assert.rejects(getProjectDiff(db, projectId, since), /Invalid timestamp/, since);
    }
    for (const since of ["2026-03-10", "2026-03-10T09:00", "2026-03-10T09:00:00.123Z", "2026-03-10T09:00:00+02:00"]) {
      await getProjectDiff(db, projectId, since);
    }
  });

  it("rejects an empty since everywhere instead of ignoring it", async () => {
    await assert.rejects(getEventLog(db, projectId, ""), /Invalid timestamp ""/);
    await assert.rejects(listProjectRevisions(db, projectId, ""), /Invalid timestamp ""/);
    await assert.rejects(getProjectDiff(db, projectId, ""), /Invalid timestamp ""/);
  });

  it("event log and project history return only what happened strictly after since", async () => {
    const [newest] = await getEventLog(db, projectId);
    assert.deepEqual(await getEventLog(db, projectId, newest.timestamp), []);
    const [revision] = await listProjectRevisions(db, projectId);
    assert.deepEqual(await listProjectRevisions(db, projectId, revision.revised_at), []);
  });

  it("reads a date-time without an offset as UTC, like a plain date", async () => {
    const at = async (since: string) => (await getProjectDiff(db, projectId, since)).since;
    assert.equal(await at("2026-03-10"), "2026-03-10T00:00:00.000Z");
    assert.equal(await at("2026-03-10T00:00"), "2026-03-10T00:00:00.000Z");
    assert.equal(await at("2026-03-10 00:00:00"), "2026-03-10T00:00:00.000Z");
  });

  it("reports the normalised since in the diff", async () => {
    assert.equal((await getProjectDiff(db, projectId, "2026-03-10T09:00:00+02:00")).since, "2026-03-10T07:00:00.000Z");
  });

  it("returns the events right after since first, so polling with a limit reaches them all", async () => {
    for (let i = 0; i < 6; i++) {
      const t = await createTicket(db, { projectId, title: `P${i}` });
      await db.run("UPDATE tickets SET created_at = ? WHERE id = ?", `2026-01-0${i + 1}T00:00:00.000Z`, t.id);
    }
    const seen: string[] = [];
    let since = "2020-01-01";
    for (;;) {
      const page = await getEventLog(db, projectId, since, 2);
      if (page.length === 0) break;
      seen.push(...page.map((e) => e.ticketTitle));
      since = page[page.length - 1].timestamp;
    }
    assert.deepEqual(seen.slice(0, 6), ["P0", "P1", "P2", "P3", "P4", "P5"]);
  });

  it("polls without losing events written in the same millisecond via after", async () => {
    for (let i = 0; i < 6; i++) await createTicket(db, { projectId, title: `P${i}` });
    await db.run("UPDATE tickets SET created_at = '2026-01-01T00:00:00.000Z'");
    const seen: string[] = [];
    let after = 0;
    for (;;) {
      const page = await getEventLog(db, projectId, undefined, 2, after);
      if (page.length === 0) break;
      seen.push(...page.filter((e) => e.type === "ticket_created").map((e) => e.ticketTitle));
      after = page[page.length - 1].sequence;
    }
    assert.deepEqual(seen, ["A", "P0", "P1", "P2", "P3", "P4", "P5"]);
  });

  it("project diff, like the event log, leaves out what happened exactly at since", async () => {
    const [newest] = await getEventLog(db, projectId);
    assert.deepEqual(await getEventLog(db, projectId, newest.timestamp), []);
    const diff = await getProjectDiff(db, projectId, newest.timestamp);
    assert.deepEqual([diff.newTickets, diff.updatedTickets, diff.tagChanges, diff.deletedTickets], [[], [], [], []]);
  });
});
