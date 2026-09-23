import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, listTickets } from "../../src/tickets/repository.js";
import { listTags } from "../../src/tags/repository.js";
import { getTicketTags } from "../../src/tags/assignment.js";
import { importCsv } from "../../src/import/csv.js";
import { exportCsv } from "../../src/export/csv.js";
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

  it("imports nothing when a row clashes with an existing ticket", async () => {
    await createTicket(db, { projectId, title: "Existing" });
    const csv = `title,benefit,tags
New1,5,state:wip
Existing,3,
New2,2,`;

    await expect(importCsv(db, projectId, csv)).rejects.toThrow("already exists");
    const titles = (await listTickets(db, projectId)).map((t) => t.title);
    expect(titles).toEqual(["Existing"]);
    expect(await listTags(db, projectId)).toHaveLength(0);
  });

  it("imports nothing when the file contains a duplicate title", async () => {
    const csv = `title,benefit
Dup,5
Dup,3`;

    await expect(importCsv(db, projectId, csv)).rejects.toThrow("already exists");
    expect(await listTickets(db, projectId)).toHaveLength(0);
  });

  it("normalises tags like the CLI does", async () => {
    await importCsv(db, projectId, `title,tags
T,"State:WIP"`);
    const tags = await listTags(db, projectId);
    expect(tags.map((t) => `${t.prefix}:${t.value}`)).toEqual(["state:wip"]);
  });

  it("rejects invalid tags with the row number", async () => {
    await expect(importCsv(db, projectId, `title,tags
T,"bad prefix:x"`)).rejects.toThrow(
      /Row 2: Tag prefix must contain only/
    );
    await expect(importCsv(db, projectId, `title,tags
T,"state:wip,x"`)).rejects.toThrow(
      /Row 2: Tag "x" must be in prefix:value format/
    );
    expect(await listTickets(db, projectId)).toHaveLength(0);
  });

  it("imports quoted fields that contain newlines", async () => {
    const csv = 'title,description,benefit\nMulti,"line1\nline2, ""q""",5\nNext,,3';
    const result = await importCsv(db, projectId, csv);
    expect(result.imported).toBe(2);
    const tickets = await listTickets(db, projectId);
    expect(tickets[0]).toMatchObject({ title: "Multi", description: 'line1\nline2, "q"', benefit: 5 });
    expect(tickets[1]).toMatchObject({ title: "Next", benefit: 3 });
  });

  it("round-trips multi-line descriptions through export and import", async () => {
    const source = await createProject(db, "Source");
    await createTicket(db, {
      projectId: source.id, title: "Multi", description: 'line1\r\nline2, "q"\nline3', benefit: 5,
    });
    await importCsv(db, projectId, await exportCsv(db, source.id));

    const [ticket] = await listTickets(db, projectId);
    expect(ticket).toMatchObject({ title: "Multi", description: 'line1\r\nline2, "q"\nline3', benefit: 5 });
  });

  it("rejects non-integer and non-numeric scores instead of truncating them", async () => {
    await expect(importCsv(db, projectId, "title,benefit\nF,5.9")).rejects.toThrow(
      /benefit must be a Fibonacci value .*got 5\.9/
    );
    await expect(importCsv(db, projectId, "title,estimate\nF,3abc")).rejects.toThrow(
      'estimate must be a number, got "3abc"'
    );
    expect(await listTickets(db, projectId)).toHaveLength(0);
  });
});
