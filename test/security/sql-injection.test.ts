import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject, listProjects, getProjectByName } from "../../src/projects/repository.js";
import { createTicket, listTickets, getTicketByTitle } from "../../src/tickets/repository.js";
import { createTag, getTag } from "../../src/tags/repository.js";

describe("SQL injection prevention", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "TestProject");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  const sqlPayloads = [
    "'; DROP TABLE projects; --",
    "1 OR 1=1",
    "' UNION SELECT * FROM projects --",
    "Robert'); DROP TABLE tickets;--",
    "' OR '1'='1",
    "1; DELETE FROM projects WHERE 1=1",
  ];

  it("project name with SQL injection produces no side effects", async () => {
    for (const payload of sqlPayloads) {
      // These will either create a project with the literal name or fail validation
      try {
        await createProject(db, payload);
      } catch {
        // validation error is expected
      }
    }
    // Original project must still exist, tables must be intact
    const projects = await listProjects(db);
    assert.equal(projects.some((p) => p.name === "TestProject"), true);
  });

  it("ticket title with SQL injection produces no side effects", async () => {
    for (const payload of sqlPayloads) {
      try {
        await createTicket(db, { projectId, title: payload });
      } catch {
        // expected
      }
    }
    const tickets = await listTickets(db, projectId);
    // No tickets should have caused table drops
    assert.notEqual(tickets, undefined);
  });

  it("ticket lookup with SQL injection returns nothing", async () => {
    for (const payload of sqlPayloads) {
      const result = await getTicketByTitle(db, projectId, payload);
      assert.equal(result, undefined);
    }
  });

  it("tag prefix/value with SQL injection produces no side effects", async () => {
    for (const payload of sqlPayloads) {
      try {
        await createTag(db, projectId, payload, "test");
        await createTag(db, projectId, "test", payload);
      } catch {
        // expected
      }
    }
    // Tables are intact
    const projects = await listProjects(db);
    assert.ok(projects.length > 0);
  });

  it("getProjectByName with SQL injection returns nothing", async () => {
    for (const payload of sqlPayloads) {
      const result = await getProjectByName(db, payload);
      assert.equal(result, undefined);
    }
  });

  it("getTag with SQL injection returns nothing", async () => {
    for (const payload of sqlPayloads) {
      const result = await getTag(db, projectId, payload, payload);
      assert.equal(result, undefined);
    }
  });
});
