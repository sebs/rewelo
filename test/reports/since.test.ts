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
    assert.equal(expected.updatedTickets.length, 1);
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
});
