import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import {
  createTicket,
  listTickets,
  getTicketById,
  updateTicket,
  deleteTicket,
} from "../../src/tickets/repository.js";
import { createTag, getTagById } from "../../src/tags/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { getProjectTimes } from "../../src/reports/times.js";

describe("multi-project isolation", () => {
  let db: DB;
  let projectA: number;
  let projectB: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const a = await createProject(db, "ProjectA");
    const b = await createProject(db, "ProjectB");
    projectA = a.id;
    projectB = b.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("listTickets only returns tickets for the specified project", async () => {
    await createTicket(db, { projectId: projectA, title: "Ticket A" });
    await createTicket(db, { projectId: projectB, title: "Ticket B" });

    const ticketsA = await listTickets(db, projectA);
    const ticketsB = await listTickets(db, projectB);

    assert.equal(ticketsA.length, 1);
    assert.equal(ticketsA[0].title, "Ticket A");
    assert.equal(ticketsB.length, 1);
    assert.equal(ticketsB[0].title, "Ticket B");
  });

  it("getTicketById cannot access ticket from another project", async () => {
    const ticket = await createTicket(db, { projectId: projectA, title: "Secret" });
    const result = await getTicketById(db, projectB, ticket.id);
    assert.equal(result, undefined);
  });

  it("updateTicket cannot modify ticket in another project", async () => {
    const ticket = await createTicket(db, { projectId: projectA, title: "Original" });
    await assert.rejects(updateTicket(db, projectB, ticket.id, { title: "Hacked" }), /Ticket not found/);
  });

  it("deleteTicket cannot delete ticket in another project", async () => {
    const ticket = await createTicket(db, { projectId: projectA, title: "Important" });
    const result = await deleteTicket(db, projectB, ticket.id);
    assert.equal(result, false);

    // Ticket still exists in project A
    const still = await getTicketById(db, projectA, ticket.id);
    assert.notEqual(still, undefined);
  });

  it("getTagById cannot access tag from another project", async () => {
    const tag = await createTag(db, projectA, "state", "backlog");
    const result = await getTagById(db, projectB, tag.id);
    assert.equal(result, undefined);
  });

  it("listing tickets by tag scopes to project", async () => {
    const ticketA = await createTicket(db, { projectId: projectA, title: "A" });
    const ticketB = await createTicket(db, { projectId: projectB, title: "B" });
    const tagA = await createTag(db, projectA, "state", "wip");
    const tagB = await createTag(db, projectB, "state", "wip");

    await assignTag(db, ticketA.id, tagA.id);
    await assignTag(db, ticketB.id, tagB.id);

    const wip = [{ prefix: "state", value: "wip" }];
    assert.deepEqual((await listTickets(db, projectA, { includeTags: wip })).map((t) => t.id), [ticketA.id]);
    assert.deepEqual((await listTickets(db, projectB, { includeTags: wip })).map((t) => t.id), [ticketB.id]);
  });

  it("calculations are scoped to project", async () => {
    const ticketA = await createTicket(db, { projectId: projectA, title: "A" });
    const ticketB = await createTicket(db, { projectId: projectB, title: "B" });

    // Each project's times cover its own tickets only
    assert.deepEqual((await getProjectTimes(db, projectA)).map((t) => t.ticketId), [ticketA.id]);
    assert.deepEqual((await getProjectTimes(db, projectB)).map((t) => t.ticketId), [ticketB.id]);
  });
});
