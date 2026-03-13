import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, updateTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import { assignTag, removeTag } from "../../src/tags/assignment.js";
import { createRevision } from "../../src/revisions/repository.js";
import { getEventLog } from "../../src/reports/event-log.js";

describe("event log", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "EvLog");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns empty log for empty project", async () => {
    const events = await getEventLog(db, projectId);
    expect(events).toHaveLength(0);
  });

  it("includes ticket_created events", async () => {
    await createTicket(db, { projectId, title: "A", benefit: 5 });
    const events = await getEventLog(db, projectId);
    expect(events.some((e) => e.type === "ticket_created" && e.ticketTitle === "A")).toBe(true);
  });

  it("includes ticket_updated events after revision + update", async () => {
    const t = await createTicket(db, { projectId, title: "B", benefit: 3 });
    await createRevision(db, t);
    await updateTicket(db, projectId, t.id, { benefit: 8 });

    const events = await getEventLog(db, projectId);
    expect(events.some((e) => e.type === "ticket_updated")).toBe(true);
  });

  it("includes tag_added and tag_removed events", async () => {
    const t = await createTicket(db, { projectId, title: "C" });
    const tag = await createTag(db, projectId, "state", "wip");
    await assignTag(db, t.id, tag.id);
    await removeTag(db, t.id, tag.id);

    const events = await getEventLog(db, projectId);
    expect(events.some((e) => e.type === "tag_added")).toBe(true);
    expect(events.some((e) => e.type === "tag_removed")).toBe(true);
  });

  it("respects since filter", async () => {
    await createTicket(db, { projectId, title: "Old" });
    const futureDate = "2099-01-01T00:00:00Z";
    const events = await getEventLog(db, projectId, futureDate);
    expect(events).toHaveLength(0);
  });

  it("respects limit", async () => {
    await createTicket(db, { projectId, title: "X1" });
    await createTicket(db, { projectId, title: "X2" });
    await createTicket(db, { projectId, title: "X3" });

    const events = await getEventLog(db, projectId, undefined, 2);
    expect(events).toHaveLength(2);
  });

  it("returns events in reverse chronological order", async () => {
    await createTicket(db, { projectId, title: "First" });
    await createTicket(db, { projectId, title: "Second" });

    const events = await getEventLog(db, projectId);
    const created = events.filter((e) => e.type === "ticket_created");
    expect(created[0].ticketTitle).toBe("Second");
    expect(created[1].ticketTitle).toBe("First");
  });
});
