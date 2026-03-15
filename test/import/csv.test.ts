import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { listTickets } from "../../src/tickets/repository.js";
import { listTags } from "../../src/tags/repository.js";
import { getTicketTags } from "../../src/tags/assignment.js";
import { importCsv } from "../../src/import/csv.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("CSV import", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Import");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("imports tickets from CSV", async () => {
    const csv = `title,benefit,penalty,estimate,risk,tags
Login,8,3,5,2,state:backlog
Signup,5,2,3,1,state:wip`;

    const result = await importCsv(db, projectId, csv);
    expect(result.imported).toBe(2);

    const tickets = await listTickets(db, projectId);
    expect(tickets).toHaveLength(2);
    expect(tickets[0].title).toBe("Login");
    expect(tickets[0].benefit).toBe(8);
  });

  it("auto-creates tags that don't exist", async () => {
    const csv = `title,benefit,penalty,estimate,risk,tags
Login,8,3,5,2,feature:auth`;

    await importCsv(db, projectId, csv);
    const tags = await listTags(db, projectId);
    expect(tags.some((t) => t.prefix === "feature" && t.value === "auth")).toBe(true);
  });

  it("assigns tags to imported tickets", async () => {
    const csv = `title,benefit,penalty,estimate,risk,tags
Login,8,3,5,2,state:backlog`;

    await importCsv(db, projectId, csv);
    const tickets = await listTickets(db, projectId);
    const tags = await getTicketTags(db, tickets[0].id);
    expect(tags).toHaveLength(1);
    expect(tags[0].prefix).toBe("state");
  });

  it("rejects invalid Fibonacci values with row number", async () => {
    const csv = `title,benefit,penalty,estimate,risk
Login,8,3,5,2
Bad,4,3,5,2`;

    await expect(importCsv(db, projectId, csv)).rejects.toThrow("Row 3");
  });

  it("imports CSV with only title and partial scores (defaults to 1)", async () => {
    const csv = `title,benefit
Login,8`;

    const result = await importCsv(db, projectId, csv);
    expect(result.imported).toBe(1);
  });

  it("rejects CSV missing title column", async () => {
    const csv = `benefit,penalty
8,3`;

    await expect(importCsv(db, projectId, csv)).rejects.toThrow("Missing required CSV column: title");
  });

  it("rejects empty CSV", async () => {
    await expect(importCsv(db, projectId, "")).rejects.toThrow("CSV is empty");
  });

  it("handles CSV with description column", async () => {
    const csv = `title,description,benefit,penalty,estimate,risk
Login,The login page,8,3,5,2`;

    await importCsv(db, projectId, csv);
    const tickets = await listTickets(db, projectId);
    expect(tickets[0].description).toBe("The login page");
  });
});
