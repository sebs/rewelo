import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { listTickets } from "../../src/tickets/repository.js";
import { listTags } from "../../src/tags/repository.js";
import { getTicketTags } from "../../src/tags/assignment.js";
import { importJson } from "../../src/import/json.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("JSON import", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "JsonImport");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("imports tickets from JSON", async () => {
    const json = JSON.stringify({
      tickets: [
        { title: "Login", benefit: 8, penalty: 3, estimate: 5, risk: 2 },
        { title: "Signup", benefit: 5, penalty: 2, estimate: 3, risk: 1 },
      ],
    });

    const result = await importJson(db, projectId, json);
    expect(result.imported).toBe(2);

    const tickets = await listTickets(db, projectId);
    expect(tickets).toHaveLength(2);
  });

  it("restores tags and assignments", async () => {
    const json = JSON.stringify({
      tickets: [
        {
          title: "Login",
          benefit: 8,
          penalty: 3,
          estimate: 5,
          risk: 2,
          tags: [{ prefix: "state", value: "backlog" }],
        },
      ],
      tags: [{ prefix: "state", value: "backlog" }],
    });

    await importJson(db, projectId, json);
    const tickets = await listTickets(db, projectId);
    const tags = await getTicketTags(db, tickets[0].id);
    expect(tags).toHaveLength(1);
    expect(tags[0].value).toBe("backlog");
  });

  it("rejects invalid JSON", async () => {
    await expect(importJson(db, projectId, "not json")).rejects.toThrow("Invalid JSON");
  });

  it("rejects missing tickets array", async () => {
    await expect(importJson(db, projectId, '{}')).rejects.toThrow("tickets");
  });

  it("rejects invalid Fibonacci values", async () => {
    const json = JSON.stringify({
      tickets: [{ title: "Bad", benefit: 4, penalty: 3, estimate: 5, risk: 2 }],
    });
    await expect(importJson(db, projectId, json)).rejects.toThrow("Ticket 1");
  });

  it("rejects deeply nested JSON", async () => {
    // Build deeply nested object
    let nested: any = { tickets: [] };
    let current = nested;
    for (let i = 0; i < 15; i++) {
      current.deep = {};
      current = current.deep;
    }
    await expect(importJson(db, projectId, JSON.stringify(nested))).rejects.toThrow("nesting depth");
  });

  it("rejects non-object input", async () => {
    await expect(importJson(db, projectId, "[]")).rejects.toThrow("must be an object");
  });
});
