import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { createRevision } from "../../src/revisions/repository.js";
import { exportJson } from "./helpers.js";
import { writeJsonExport } from "../../src/transfer/json/export.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("JSON export", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "JsonExport");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("exports empty project", async () => {
    const data = await exportJson(db, projectId);
    assert.equal(data.tickets.length, 0);
    assert.equal(data.tags.length, 0);
  });

  it("exports tickets and tags", async () => {
    const ticket = await createTicket(db, { projectId, title: "Feature X", benefit: 5, penalty: 3, estimate: 8, risk: 2 });
    const tag = await createTag(db, projectId, "feature", "auth");
    await assignTag(db, ticket.id, tag.id);

    const data = await exportJson(db, projectId);
    assert.equal(data.tickets.length, 1);
    assert.equal(data.tickets[0].title, "Feature X");
    assert.deepEqual(data.tickets[0].tags, [{ prefix: "feature", value: "auth" }]);
    assert.deepEqual(data.tags, [{ prefix: "feature", value: "auth" }]);
  });

  it("includes history when requested", async () => {
    const ticket = await createTicket(db, { projectId, title: "Rev", benefit: 3, penalty: 2, estimate: 5, risk: 3 });
    await updateTicket(db, projectId, ticket.id, { benefit: 8 });

    const data = await exportJson(db, projectId, { withHistory: true });
    assert.notEqual(data.tickets[0].revisions, undefined);
    assert.equal(data.tickets[0].revisions!.length, 1);
  });

  it("writes a history export one ticket per line, without the history rows' own ids", async () => {
    const ticket = await createTicket(db, { projectId, title: "Rev", benefit: 3 });
    await updateTicket(db, projectId, ticket.id, { benefit: 8 });
    await createTicket(db, { projectId, title: "Other" });
    let text = "";
    await writeJsonExport(db, projectId, { withHistory: true }, async (chunks) => {
      for await (const chunk of chunks) text += chunk;
    });
    assert.equal(text.split("\n").filter((l) => l.startsWith('    {"title":')).length, 2);
    const [revision] = JSON.parse(text).tickets[0].revisions;
    assert.equal(revision.id, undefined);
    assert.equal(revision.ticket_id, undefined);
    assert.equal(revision.benefit, 3);
  });

  it("does not include history by default", async () => {
    const ticket = await createTicket(db, { projectId, title: "NoHist", benefit: 3, penalty: 2, estimate: 5, risk: 3 });
    await createRevision(db, ticket);

    const data = await exportJson(db, projectId);
    assert.equal(data.tickets[0].revisions, undefined);
  });

  it("is project-scoped", async () => {
    const project2 = await createProject(db, "Other");
    await createTicket(db, { projectId, title: "A" });
    await createTicket(db, { projectId: project2.id, title: "B" });

    const data = await exportJson(db, projectId);
    assert.equal(data.tickets.length, 1);
    assert.equal(data.tickets[0].title, "A");
  });
});

describe("JSON export with history under concurrent writes", () => {
  it("reads one snapshot, so another process's writes in between don't break it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-snap-"));
    const path = join(dir, "snap.db");
    const db = await DB.open(path);
    await migrate(db);
    const other = await DB.open(path);
    try {
      const { id } = await createProject(db, "P");
      for (const title of ["A", "B", "C"]) await createTicket(db, { projectId: id, title });

      // Another process deletes a ticket and adds one halfway through the export
      const all = db.all.bind(db);
      let calls = 0;
      db.all = (async (sql: string, ...params: unknown[]) => {
        if (++calls === 3) {
          await other.run("DELETE FROM tickets WHERE title = 'A'");
          await other.run("INSERT INTO tickets (project_id, title, created_at) VALUES (?, '0 old', '2000-01-01T00:00:00.000Z')", id);
        }
        return all(sql, ...params);
      }) as typeof db.all;
      const exported = await exportJson(db, id, { withHistory: true });
      db.all = all;

      assert.deepEqual(exported.tickets.map((t) => t.title), ["A", "B", "C"]);
      assert.ok(exported.tickets.every((t) => (t as { createdAt?: string }).createdAt! > "2001"));
    } finally {
      await other.close();
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
