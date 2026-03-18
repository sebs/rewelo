import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createTag } from "../../src/tags/repository.js";
import {
  assignTag,
  removeTag,
  getTicketTags,
  listTicketsByTag,
} from "../../src/tags/assignment.js";
import { getTagChangeLog } from "../../src/tags/audit.js";

describe("tag assignment", () => {
  let db: DB;
  let projectId: number;
  let ticketId: number;
  let tagId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
    const ticket = await createTicket(db, { projectId, title: "Login page" });
    ticketId = ticket.id;
    const tag = await createTag(db, projectId, "state", "backlog");
    tagId = tag.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("assigns a tag to a ticket", async () => {
    const assigned = await assignTag(db, ticketId, tagId);
    expect(assigned).toBe(true);
    const tags = await getTicketTags(db, ticketId);
    expect(tags).toHaveLength(1);
    expect(tags[0].prefix).toBe("state");
    expect(tags[0].value).toBe("backlog");
  });

  it("is idempotent when assigning the same tag twice", async () => {
    await assignTag(db, ticketId, tagId);
    const second = await assignTag(db, ticketId, tagId);
    expect(second).toBe(false);
    const tags = await getTicketTags(db, ticketId);
    expect(tags).toHaveLength(1);
  });

  it("does not create duplicate audit entries on idempotent assign", async () => {
    await assignTag(db, ticketId, tagId);
    await assignTag(db, ticketId, tagId);
    const log = await getTagChangeLog(db, ticketId);
    expect(log).toHaveLength(1);
  });

  it("removes a tag from a ticket", async () => {
    await assignTag(db, ticketId, tagId);
    const removed = await removeTag(db, ticketId, tagId);
    expect(removed).toBe(true);
    const tags = await getTicketTags(db, ticketId);
    expect(tags).toHaveLength(0);
  });

  it("returns false when removing a tag that is not assigned", async () => {
    const removed = await removeTag(db, ticketId, tagId);
    expect(removed).toBe(false);
  });

  it("supports multiple tags with different prefixes on one ticket", async () => {
    const tag2 = await createTag(db, projectId, "feature", "auth");
    const tag3 = await createTag(db, projectId, "team", "platform");
    await assignTag(db, ticketId, tagId);
    await assignTag(db, ticketId, tag2.id);
    await assignTag(db, ticketId, tag3.id);
    const tags = await getTicketTags(db, ticketId);
    expect(tags).toHaveLength(3);
  });

  it("replaces existing tag with same prefix on assign", async () => {
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, ticketId, tagId); // state:backlog
    await assignTag(db, ticketId, wip.id); // state:wip replaces state:backlog
    const tags = await getTicketTags(db, ticketId);
    expect(tags).toHaveLength(1);
    expect(tags[0].prefix).toBe("state");
    expect(tags[0].value).toBe("wip");
  });

  it("logs removal of replaced same-prefix tag", async () => {
    const wip = await createTag(db, projectId, "state", "wip");
    await assignTag(db, ticketId, tagId); // state:backlog
    await assignTag(db, ticketId, wip.id); // replaces state:backlog
    const log = await getTagChangeLog(db, ticketId);
    expect(log.map((e) => `${e.action}:${e.prefix}:${e.value}`)).toEqual([
      "added:state:backlog",
      "removed:state:backlog",
      "added:state:wip",
    ]);
  });

  it("lists tickets by tag", async () => {
    const ticket2 = await createTicket(db, { projectId, title: "Signup flow" });
    await assignTag(db, ticketId, tagId);
    await assignTag(db, ticket2.id, tagId);
    const ticketIds = await listTicketsByTag(db, projectId, tagId);
    expect(ticketIds).toContain(ticketId);
    expect(ticketIds).toContain(ticket2.id);
  });
});

describe("tag audit log", () => {
  let db: DB;
  let projectId: number;
  let ticketId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
    const ticket = await createTicket(db, { projectId, title: "Login page" });
    ticketId = ticket.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("records full state transition history", async () => {
    const backlog = await createTag(db, projectId, "state", "backlog");
    const wip = await createTag(db, projectId, "state", "wip");
    const done = await createTag(db, projectId, "state", "done");

    await assignTag(db, ticketId, backlog.id);
    await removeTag(db, ticketId, backlog.id);
    await assignTag(db, ticketId, wip.id);
    await removeTag(db, ticketId, wip.id);
    await assignTag(db, ticketId, done.id);

    const log = await getTagChangeLog(db, ticketId);
    expect(log).toHaveLength(5);
    expect(log.map((e) => `${e.action}:${e.prefix}:${e.value}`)).toEqual([
      "added:state:backlog",
      "removed:state:backlog",
      "added:state:wip",
      "removed:state:wip",
      "added:state:done",
    ]);
  });

  it("preserves timestamp ordering", async () => {
    const backlog = await createTag(db, projectId, "state", "backlog");
    const wip = await createTag(db, projectId, "state", "wip");

    await assignTag(db, ticketId, backlog.id);
    await assignTag(db, ticketId, wip.id); // auto-removes backlog

    const log = await getTagChangeLog(db, ticketId);
    expect(log).toHaveLength(3);
    for (let i = 1; i < log.length; i++) {
      expect(new Date(log[i - 1].changed_at).getTime()).toBeLessThanOrEqual(
        new Date(log[i].changed_at).getTime()
      );
    }
  });
});
