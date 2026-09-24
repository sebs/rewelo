import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import {
  createTicket,
  listTickets,
  getTicketByTitle,
  updateTicket,
  upsertTicket,
  deleteTicket,
} from "../../src/tickets/repository.js";

describe("tickets repository", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates a ticket with default scores", async () => {
    const ticket = await createTicket(db, {
      projectId,
      title: "Login page",
    });
    assert.equal(ticket.title, "Login page");
    assert.equal(ticket.benefit, 1);
    assert.equal(ticket.penalty, 1);
    assert.equal(ticket.estimate, 1);
    assert.equal(ticket.risk, 1);
    assert.notEqual(ticket.ticket_uuid, undefined);
  });

  it("creates a ticket with explicit scores", async () => {
    const ticket = await createTicket(db, {
      projectId,
      title: "Login page",
      benefit: 8,
      penalty: 5,
      estimate: 3,
      risk: 2,
    });
    assert.equal(ticket.benefit, 8);
    assert.equal(ticket.penalty, 5);
    assert.equal(ticket.estimate, 3);
    assert.equal(ticket.risk, 2);
  });

  it("rejects invalid Fibonacci values", async () => {
    await assert.rejects(createTicket(db, { projectId, title: "Bad", benefit: 4 }), /benefit must be a Fibonacci value/);
  });

  for (const value of [0, 4, 6, 10, 15]) {
    it(`rejects benefit=${value}`, async () => {
      await assert.rejects(createTicket(db, { projectId, title: "Bad", benefit: value }), /benefit must be a Fibonacci value/);
    });
  }

  it("lists tickets in a project", async () => {
    await createTicket(db, { projectId, title: "Story A" });
    await createTicket(db, { projectId, title: "Story B" });
    const tickets = await listTickets(db, projectId);
    assert.equal(tickets.length, 2);
  });

  it("gets a ticket by title", async () => {
    await createTicket(db, { projectId, title: "Login page" });
    const ticket = await getTicketByTitle(db, projectId, "Login page");
    assert.notEqual(ticket, undefined);
    assert.equal(ticket!.title, "Login page");
  });

  it("returns undefined for non-existent ticket", async () => {
    const ticket = await getTicketByTitle(db, projectId, "No such ticket");
    assert.equal(ticket, undefined);
  });

  it("updates a ticket's scores", async () => {
    const created = await createTicket(db, {
      projectId,
      title: "Login page",
      benefit: 3,
      penalty: 2,
      estimate: 5,
      risk: 3,
    });
    const updated = await updateTicket(db, projectId, created.id, {
      benefit: 8,
      penalty: 5,
      estimate: 3,
      risk: 2,
    });
    assert.equal(updated.benefit, 8);
    assert.equal(updated.penalty, 5);
    assert.equal(updated.estimate, 3);
    assert.equal(updated.risk, 2);
  });

  it("updates only specified fields", async () => {
    const created = await createTicket(db, {
      projectId,
      title: "Login page",
      benefit: 3,
      penalty: 2,
      estimate: 5,
      risk: 3,
    });
    const updated = await updateTicket(db, projectId, created.id, {
      benefit: 13,
    });
    assert.equal(updated.benefit, 13);
    assert.equal(updated.penalty, 2);
    assert.equal(updated.estimate, 5);
    assert.equal(updated.risk, 3);
  });

  it("rejects invalid Fibonacci on update", async () => {
    const created = await createTicket(db, { projectId, title: "Login page" });
    await assert.rejects(updateTicket(db, projectId, created.id, { benefit: 4 }), /benefit must be a Fibonacci value/);
  });

  it("deletes a ticket", async () => {
    const created = await createTicket(db, { projectId, title: "Login page" });
    const deleted = await deleteTicket(db, projectId, created.id);
    assert.equal(deleted, true);
    const tickets = await listTickets(db, projectId);
    assert.equal(tickets.length, 0);
  });

  it("returns false when deleting non-existent ticket", async () => {
    const deleted = await deleteTicket(db, projectId, 9999);
    assert.equal(deleted, false);
  });

  // =========================================================================
  //  UPSERT
  // =========================================================================

  it("upsert creates a new ticket when title does not exist", async () => {
    const result = await upsertTicket(db, projectId, "New Feature", {
      benefit: 8,
      penalty: 5,
      estimate: 3,
      risk: 2,
    });
    assert.equal(result.action, "created");
    assert.equal(result.ticket.title, "New Feature");
    assert.equal(result.ticket.benefit, 8);
  });

  it("upsert updates an existing ticket when title matches", async () => {
    await createTicket(db, { projectId, title: "Login page", benefit: 3, penalty: 2, estimate: 1, risk: 1 });

    const result = await upsertTicket(db, projectId, "Login page", {
      benefit: 13,
      penalty: 8,
    });
    assert.equal(result.action, "updated");
    assert.equal(result.ticket.benefit, 13);
    assert.equal(result.ticket.penalty, 8);
    // Unchanged fields preserved
    assert.equal(result.ticket.estimate, 1);
    assert.equal(result.ticket.risk, 1);
  });

  it("upsert is idempotent — repeated calls with same data produce same result", async () => {
    const r1 = await upsertTicket(db, projectId, "Idempotent", { benefit: 5 });
    assert.equal(r1.action, "created");

    const r2 = await upsertTicket(db, projectId, "Idempotent", { benefit: 5 });
    assert.equal(r2.action, "updated");
    assert.equal(r2.ticket.id, r1.ticket.id);
    assert.equal(r2.ticket.benefit, 5);

    const tickets = await listTickets(db, projectId);
    const matches = tickets.filter((t) => t.title === "Idempotent");
    assert.equal(matches.length, 1);
  });

  it("upsert with no scores creates ticket with defaults", async () => {
    const result = await upsertTicket(db, projectId, "Bare ticket", {});
    assert.equal(result.action, "created");
    assert.equal(result.ticket.benefit, 1);
    assert.equal(result.ticket.penalty, 1);
    assert.equal(result.ticket.estimate, 1);
    assert.equal(result.ticket.risk, 1);
  });

  it("upsert only updates provided fields on existing ticket", async () => {
    await createTicket(db, { projectId, title: "Partial", benefit: 13, penalty: 8, estimate: 5, risk: 3 });

    const result = await upsertTicket(db, projectId, "Partial", { risk: 13 });
    assert.equal(result.action, "updated");
    assert.equal(result.ticket.benefit, 13);
    assert.equal(result.ticket.penalty, 8);
    assert.equal(result.ticket.estimate, 5);
    assert.equal(result.ticket.risk, 13);
  });

  it("cascades delete when project is deleted", async () => {
    await createTicket(db, { projectId, title: "Login page" });
    const { deleteProject } = await import("../../src/projects/repository.js");
    await deleteProject(db, "Acme");
    const tickets = await listTickets(db, projectId);
    assert.equal(tickets.length, 0);
  });

  it("searches titles case-insensitively beyond ASCII", async () => {
    await createTicket(db, { projectId, title: "Äpfel kaufen" });
    await createTicket(db, { projectId, title: "Über uns" });
    await createTicket(db, { projectId, title: "Straße" });

    const titles = async (search: string) =>
      (await listTickets(db, projectId, { search })).map((t) => t.title);
    assert.deepEqual(await titles("äpfel"), ["Äpfel kaufen"]);
    assert.deepEqual(await titles("ÜBER"), ["Über uns"]);
    assert.deepEqual(await titles("straße"), ["Straße"]);
  });
});
