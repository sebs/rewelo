import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject, getProjectByName } from "../../src/projects/repository.js";
import { createTicket, listTickets } from "../../src/tickets/repository.js";
import { listTags } from "../../src/tags/repository.js";
import { getTicketTags } from "../../src/tags/assignment.js";
import { importJson, importJsonAsProject } from "../../src/import/json.js";
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

  it("imports nothing when a ticket clashes with an existing one", async () => {
    await createTicket(db, { projectId, title: "Existing" });
    const json = JSON.stringify({
      tags: [{ prefix: "state", value: "wip" }],
      tickets: [
        { title: "New1", benefit: 5, penalty: 1, estimate: 1, risk: 1 },
        { title: "Existing", benefit: 3, penalty: 1, estimate: 1, risk: 1 },
      ],
    });

    await expect(importJson(db, projectId, json)).rejects.toThrow("already exists");
    const titles = (await listTickets(db, projectId)).map((t) => t.title);
    expect(titles).toEqual(["Existing"]);
  });

  it("rejects malformed ticket tags with a validation error", async () => {
    const json = JSON.stringify({
      tickets: [{ title: "T", benefit: 1, penalty: 1, estimate: 1, risk: 1, tags: ["state:done"] }],
    });

    await expect(importJson(db, projectId, json)).rejects.toThrow(ValidationError);
    await expect(importJson(db, projectId, json)).rejects.toThrow("Ticket 1: tag 1");
    expect(await listTickets(db, projectId)).toHaveLength(0);
  });

  it("rejects malformed project tags with a validation error", async () => {
    const json = JSON.stringify({ tickets: [], tags: [{ prefix: true, value: "x" }] });

    await expect(importJson(db, projectId, json)).rejects.toThrow(ValidationError);
    await expect(importJson(db, projectId, json)).rejects.toThrow("Tag 1");
  });

  it("rejects a non-array tags field", async () => {
    const json = JSON.stringify({ tickets: [], tags: "state:wip" });

    await expect(importJson(db, projectId, json)).rejects.toThrow(ValidationError);
  });

  it("normalises tags like the CLI does", async () => {
    const json = JSON.stringify({
      tags: [{ prefix: "Team", value: "Core" }],
      tickets: [{ title: "T", benefit: 1, penalty: 1, estimate: 1, risk: 1, tags: [{ prefix: "State", value: "Done" }] }],
    });
    await importJson(db, projectId, json);
    const tags = (await listTags(db, projectId)).map((t) => `${t.prefix}:${t.value}`).sort();
    expect(tags).toEqual(["state:done", "team:core"]);
  });

  it("rejects tags the CLI would reject", async () => {
    const bad = (tags: unknown) =>
      JSON.stringify({ tickets: [{ title: "T", benefit: 1, penalty: 1, estimate: 1, risk: 1, tags }] });

    await expect(importJson(db, projectId, bad([{ prefix: "Bad Prefix!", value: "x" }]))).rejects.toThrow(
      /Ticket 1: tag 1: Tag prefix must contain only/
    );
    await expect(importJson(db, projectId, bad([{ prefix: "a", value: "" }]))).rejects.toThrow(
      /Tag value must not be empty/
    );
    await expect(
      importJson(db, projectId, JSON.stringify({ tickets: [], tags: [{ prefix: "a:b", value: "c" }] }))
    ).rejects.toThrow(/Tag 1: Tag prefix must contain only/);
    expect(await listTickets(db, projectId)).toHaveLength(0);
  });

  it("creates the project when importing into a new one", async () => {
    const json = JSON.stringify({
      tickets: [{ title: "T", benefit: 5, penalty: 1, estimate: 1, risk: 1, tags: [{ prefix: "state", value: "wip" }] }],
    });
    const result = await importJsonAsProject(db, "NewProject", json);
    expect(result).toMatchObject({ imported: 1, projectCreated: true });

    const project = await getProjectByName(db, "NewProject");
    expect(project).toBeTruthy();
    const tickets = await listTickets(db, project!.id);
    expect(tickets.map((t) => t.title)).toEqual(["T"]);
    expect(await listTags(db, project!.id)).toHaveLength(1);
  });

  it("imports into an existing project without creating one", async () => {
    const json = JSON.stringify({ tickets: [{ title: "T", benefit: 1, penalty: 1, estimate: 1, risk: 1 }] });
    const result = await importJsonAsProject(db, "JsonImport", json);
    expect(result).toMatchObject({ imported: 1, projectCreated: false });
    expect(await listTickets(db, projectId)).toHaveLength(1);
  });

  it("does not leave a new project behind when the import fails", async () => {
    const json = JSON.stringify({
      tickets: [
        { title: "Dup", benefit: 1, penalty: 1, estimate: 1, risk: 1 },
        { title: "Dup", benefit: 1, penalty: 1, estimate: 1, risk: 1 },
      ],
    });
    await expect(importJsonAsProject(db, "Doomed", json)).rejects.toThrow("already exists");
    expect(await getProjectByName(db, "Doomed")).toBeFalsy();
  });

  it("rejects two values of one tag prefix on a ticket", async () => {
    const json = JSON.stringify({
      tickets: [{ title: "T", benefit: 1, penalty: 1, estimate: 1, risk: 1,
        tags: [{ prefix: "state", value: "wip" }, { prefix: "state", value: "done" }] }],
    });
    await expect(importJson(db, projectId, json)).rejects.toThrow(/Ticket 1: .*share the prefix "state"/);
  });
});
