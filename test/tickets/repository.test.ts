import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    expect(ticket.title).toBe("Login page");
    expect(ticket.benefit).toBe(1);
    expect(ticket.penalty).toBe(1);
    expect(ticket.estimate).toBe(1);
    expect(ticket.risk).toBe(1);
    expect(ticket.ticket_uuid).toBeDefined();
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
    expect(ticket.benefit).toBe(8);
    expect(ticket.penalty).toBe(5);
    expect(ticket.estimate).toBe(3);
    expect(ticket.risk).toBe(2);
  });

  it("rejects invalid Fibonacci values", async () => {
    await expect(
      createTicket(db, { projectId, title: "Bad", benefit: 4 })
    ).rejects.toThrow("benefit must be a Fibonacci value");
  });

  it.each([0, 4, 6, 10, 15])("rejects benefit=%d", async (value) => {
    await expect(
      createTicket(db, { projectId, title: "Bad", benefit: value })
    ).rejects.toThrow("benefit must be a Fibonacci value");
  });

  it("lists tickets in a project", async () => {
    await createTicket(db, { projectId, title: "Story A" });
    await createTicket(db, { projectId, title: "Story B" });
    const tickets = await listTickets(db, projectId);
    expect(tickets).toHaveLength(2);
  });

  it("gets a ticket by title", async () => {
    await createTicket(db, { projectId, title: "Login page" });
    const ticket = await getTicketByTitle(db, projectId, "Login page");
    expect(ticket).toBeDefined();
    expect(ticket!.title).toBe("Login page");
  });

  it("returns undefined for non-existent ticket", async () => {
    const ticket = await getTicketByTitle(db, projectId, "No such ticket");
    expect(ticket).toBeUndefined();
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
    expect(updated.benefit).toBe(8);
    expect(updated.penalty).toBe(5);
    expect(updated.estimate).toBe(3);
    expect(updated.risk).toBe(2);
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
    expect(updated.benefit).toBe(13);
    expect(updated.penalty).toBe(2);
    expect(updated.estimate).toBe(5);
    expect(updated.risk).toBe(3);
  });

  it("rejects invalid Fibonacci on update", async () => {
    const created = await createTicket(db, { projectId, title: "Login page" });
    await expect(
      updateTicket(db, projectId, created.id, { benefit: 4 })
    ).rejects.toThrow("benefit must be a Fibonacci value");
  });

  it("deletes a ticket", async () => {
    const created = await createTicket(db, { projectId, title: "Login page" });
    const deleted = await deleteTicket(db, projectId, created.id);
    expect(deleted).toBe(true);
    const tickets = await listTickets(db, projectId);
    expect(tickets).toHaveLength(0);
  });

  it("returns false when deleting non-existent ticket", async () => {
    const deleted = await deleteTicket(db, projectId, 9999);
    expect(deleted).toBe(false);
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
    expect(result.action).toBe("created");
    expect(result.ticket.title).toBe("New Feature");
    expect(result.ticket.benefit).toBe(8);
  });

  it("upsert updates an existing ticket when title matches", async () => {
    await createTicket(db, { projectId, title: "Login page", benefit: 3, penalty: 2, estimate: 1, risk: 1 });

    const result = await upsertTicket(db, projectId, "Login page", {
      benefit: 13,
      penalty: 8,
    });
    expect(result.action).toBe("updated");
    expect(result.ticket.benefit).toBe(13);
    expect(result.ticket.penalty).toBe(8);
    // Unchanged fields preserved
    expect(result.ticket.estimate).toBe(1);
    expect(result.ticket.risk).toBe(1);
  });

  it("upsert is idempotent — repeated calls with same data produce same result", async () => {
    const r1 = await upsertTicket(db, projectId, "Idempotent", { benefit: 5 });
    expect(r1.action).toBe("created");

    const r2 = await upsertTicket(db, projectId, "Idempotent", { benefit: 5 });
    expect(r2.action).toBe("updated");
    expect(r2.ticket.id).toBe(r1.ticket.id);
    expect(r2.ticket.benefit).toBe(5);

    const tickets = await listTickets(db, projectId);
    const matches = tickets.filter((t) => t.title === "Idempotent");
    expect(matches).toHaveLength(1);
  });

  it("upsert with no scores creates ticket with defaults", async () => {
    const result = await upsertTicket(db, projectId, "Bare ticket", {});
    expect(result.action).toBe("created");
    expect(result.ticket.benefit).toBe(1);
    expect(result.ticket.penalty).toBe(1);
    expect(result.ticket.estimate).toBe(1);
    expect(result.ticket.risk).toBe(1);
  });

  it("upsert only updates provided fields on existing ticket", async () => {
    await createTicket(db, { projectId, title: "Partial", benefit: 13, penalty: 8, estimate: 5, risk: 3 });

    const result = await upsertTicket(db, projectId, "Partial", { risk: 13 });
    expect(result.action).toBe("updated");
    expect(result.ticket.benefit).toBe(13);
    expect(result.ticket.penalty).toBe(8);
    expect(result.ticket.estimate).toBe(5);
    expect(result.ticket.risk).toBe(13);
  });

  it("cascades delete when project is deleted", async () => {
    await createTicket(db, { projectId, title: "Login page" });
    const { deleteProject } = await import("../../src/projects/repository.js");
    await deleteProject(db, "Acme");
    const tickets = await listTickets(db, projectId);
    expect(tickets).toHaveLength(0);
  });
});
