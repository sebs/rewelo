import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, listTickets } from "../../src/tickets/repository.js";
import { createTag, listTags } from "../../src/tags/repository.js";
import { assignTag, getTicketTags } from "../../src/tags/assignment.js";
import { setWeights, getWeights } from "../../src/weights/repository.js";
import { backup } from "../../src/backup/backup.js";
import { restore } from "../../src/backup/restore.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("backup", () => {
  let db: DB;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates a backup with schema version and app version", async () => {
    await createProject(db, "TestProject");
    const data = await backup(db);
    expect(data.schemaVersion).toBe(1);
    expect(data.appVersion).toBeDefined();
    expect(data.createdAt).toBeDefined();
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].name).toBe("TestProject");
  });

  it("backs up all projects with tickets, tags, and weights", async () => {
    const proj = await createProject(db, "Acme");
    const tag = await createTag(db, proj.id, "state", "backlog");
    const ticket = await createTicket(db, {
      projectId: proj.id,
      title: "Story A",
      benefit: 8,
      penalty: 5,
      estimate: 3,
      risk: 2,
    });
    await assignTag(db, ticket.id, tag.id);
    await setWeights(db, proj.id, 2, 3, 1, 1);

    const data = await backup(db);
    const p = data.projects[0];

    expect(p.tickets).toHaveLength(1);
    expect(p.tickets[0].title).toBe("Story A");
    expect(p.tickets[0].benefit).toBe(8);
    expect(p.tickets[0].tags).toEqual([{ prefix: "state", value: "backlog" }]);
    expect(p.tags).toEqual([{ prefix: "state", value: "backlog" }]);
    expect(p.weights).toEqual({ w1: 2, w2: 3, w3: 1, w4: 1 });
  });

  it("omits weights when they are defaults", async () => {
    await createProject(db, "Defaults");
    const data = await backup(db);
    expect(data.projects[0].weights).toBeNull();
  });

  it("backs up multiple projects", async () => {
    await createProject(db, "Alpha");
    await createProject(db, "Beta");
    const data = await backup(db);
    expect(data.projects).toHaveLength(2);
  });
});

describe("restore", () => {
  let db: DB;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("restores a full backup into a fresh database", async () => {
    const backupJson = JSON.stringify({
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
      appVersion: "0.1.0",
      projects: [
        {
          name: "Acme",
          tags: [{ prefix: "state", value: "backlog" }],
          tickets: [
            {
              title: "Story A",
              description: "Some work",
              benefit: 8,
              penalty: 5,
              estimate: 3,
              risk: 2,
              tags: [{ prefix: "state", value: "backlog" }],
            },
          ],
          weights: { w1: 2, w2: 3, w3: 1, w4: 1 },
        },
      ],
    });

    const result = await restore(db, backupJson);
    expect(result.projects).toBe(1);
    expect(result.tickets).toBe(1);
    expect(result.tags).toBe(1);

    const tickets = await listTickets(db, 1);
    expect(tickets).toHaveLength(1);
    expect(tickets[0].title).toBe("Story A");
    expect(tickets[0].benefit).toBe(8);

    const tags = await listTags(db, 1);
    expect(tags).toHaveLength(1);

    const ticketTags = await getTicketTags(db, tickets[0].id);
    expect(ticketTags).toHaveLength(1);
    expect(ticketTags[0].prefix).toBe("state");

    const weights = await getWeights(db, 1);
    expect(weights.w1).toBe(2);
    expect(weights.w2).toBe(3);
  });

  it("rejects incompatible schema version", async () => {
    const json = JSON.stringify({ schemaVersion: 99, projects: [] });
    await expect(restore(db, json)).rejects.toThrow(ValidationError);
    await expect(restore(db, json)).rejects.toThrow("Incompatible schema version");
  });

  it("rejects restore when project already exists", async () => {
    await createProject(db, "Existing");
    const json = JSON.stringify({
      schemaVersion: 1,
      projects: [{ name: "Existing", tickets: [], tags: [] }],
    });
    await expect(restore(db, json)).rejects.toThrow("already exists");
  });

  it("rejects invalid JSON", async () => {
    await expect(restore(db, "not-json")).rejects.toThrow("Invalid JSON");
  });

  it("rejects missing schemaVersion", async () => {
    const json = JSON.stringify({ projects: [] });
    await expect(restore(db, json)).rejects.toThrow("schemaVersion");
  });
});

describe("backup → restore roundtrip", () => {
  it("preserves all data through a backup and restore cycle", async () => {
    // Create source database with data
    const srcDb = await DB.open(":memory:");
    await migrate(srcDb);
    const proj = await createProject(srcDb, "Roundtrip");
    const tag = await createTag(srcDb, proj.id, "feature", "auth");
    const ticket = await createTicket(srcDb, {
      projectId: proj.id,
      title: "Auth flow",
      description: "Implement auth",
      benefit: 13,
      penalty: 8,
      estimate: 5,
      risk: 3,
    });
    await assignTag(srcDb, ticket.id, tag.id);
    await setWeights(srcDb, proj.id, 2, 2, 1, 1);

    // Backup
    const data = await backup(srcDb);
    const json = JSON.stringify(data);
    await srcDb.close();

    // Restore into fresh database
    const dstDb = await DB.open(":memory:");
    await migrate(dstDb);
    const result = await restore(dstDb, json);
    expect(result.projects).toBe(1);
    expect(result.tickets).toBe(1);

    // Verify data integrity
    const tickets = await listTickets(dstDb, 1);
    expect(tickets[0].title).toBe("Auth flow");
    expect(tickets[0].description).toBe("Implement auth");
    expect(tickets[0].benefit).toBe(13);
    expect(tickets[0].penalty).toBe(8);
    expect(tickets[0].estimate).toBe(5);
    expect(tickets[0].risk).toBe(3);

    const ticketTags = await getTicketTags(dstDb, tickets[0].id);
    expect(ticketTags).toHaveLength(1);
    expect(ticketTags[0].prefix).toBe("feature");
    expect(ticketTags[0].value).toBe("auth");

    const weights = await getWeights(dstDb, 1);
    expect(weights.w1).toBe(2);
    expect(weights.w2).toBe(2);
    expect(weights.w3).toBe(1);
    expect(weights.w4).toBe(1);

    await dstDb.close();
  });
});
