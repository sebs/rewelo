import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, deleteTicket } from "../../src/tickets/repository.js";
import {
  createRelation,
  removeRelation,
  listRelations,
} from "../../src/relations/repository.js";
import { ValidationError } from "../../src/validation/strings.js";

describe("relations repository", () => {
  let db: DB;
  let projectId: number;
  let ticketA: number;
  let ticketB: number;
  let ticketC: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
    const a = await createTicket(db, { projectId, title: "Auth service" });
    const b = await createTicket(db, { projectId, title: "Login page" });
    const c = await createTicket(db, { projectId, title: "Signup flow" });
    ticketA = a.id;
    ticketB = b.id;
    ticketC = c.id;
  });

  afterEach(async () => {
    await db.close();
  });

  // -- Dependency relations --

  it("creates blocks / is-blocked-by", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA.some((r) => r.relation_type === "blocks" && r.ticket_id === ticketB)).toBe(true);
    expect(relB.some((r) => r.relation_type === "is-blocked-by" && r.ticket_id === ticketA)).toBe(true);
  });

  it("creates depends-on / is-depended-on-by", async () => {
    await createRelation(db, projectId, ticketB, ticketA, "depends-on");
    const relB = await listRelations(db, projectId, ticketB);
    const relA = await listRelations(db, projectId, ticketA);
    expect(relB.some((r) => r.relation_type === "depends-on")).toBe(true);
    expect(relA.some((r) => r.relation_type === "is-depended-on-by")).toBe(true);
  });

  // -- Logical / Semantic --

  it("creates relates-to (symmetric)", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "relates-to");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA.some((r) => r.relation_type === "relates-to" && r.ticket_id === ticketB)).toBe(true);
    expect(relB.some((r) => r.relation_type === "relates-to" && r.ticket_id === ticketA)).toBe(true);
  });

  it("creates duplicates / is-duplicated-by", async () => {
    await createRelation(db, projectId, ticketC, ticketB, "duplicates");
    const relC = await listRelations(db, projectId, ticketC);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relC.some((r) => r.relation_type === "duplicates")).toBe(true);
    expect(relB.some((r) => r.relation_type === "is-duplicated-by")).toBe(true);
  });

  it("creates supersedes / is-superseded-by", async () => {
    await createRelation(db, projectId, ticketC, ticketB, "supersedes");
    const relC = await listRelations(db, projectId, ticketC);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relC.some((r) => r.relation_type === "supersedes")).toBe(true);
    expect(relB.some((r) => r.relation_type === "is-superseded-by")).toBe(true);
  });

  // -- Temporal --

  it("creates precedes / follows", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "precedes");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA.some((r) => r.relation_type === "precedes")).toBe(true);
    expect(relB.some((r) => r.relation_type === "follows")).toBe(true);
  });

  // -- Scope / Verification --

  it("creates tests / is-tested-by", async () => {
    await createRelation(db, projectId, ticketC, ticketA, "tests");
    const relC = await listRelations(db, projectId, ticketC);
    const relA = await listRelations(db, projectId, ticketA);
    expect(relC.some((r) => r.relation_type === "tests")).toBe(true);
    expect(relA.some((r) => r.relation_type === "is-tested-by")).toBe(true);
  });

  it("creates implements / is-implemented-by", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "implements");
    const relB = await listRelations(db, projectId, ticketB);
    expect(relB.some((r) => r.relation_type === "is-implemented-by")).toBe(true);
  });

  it("creates addresses / is-addressed-by", async () => {
    await createRelation(db, projectId, ticketB, ticketA, "addresses");
    const relA = await listRelations(db, projectId, ticketA);
    expect(relA.some((r) => r.relation_type === "is-addressed-by")).toBe(true);
  });

  // -- Effort / Scope --

  it("creates splits-into / is-split-from", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "splits-into");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA.some((r) => r.relation_type === "splits-into")).toBe(true);
    expect(relB.some((r) => r.relation_type === "is-split-from")).toBe(true);
  });

  // -- Knowledge / Reference --

  it("creates informs / is-informed-by", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "informs");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA.some((r) => r.relation_type === "informs")).toBe(true);
    expect(relB.some((r) => r.relation_type === "is-informed-by")).toBe(true);
  });

  it("creates see-also (symmetric)", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "see-also");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA.some((r) => r.relation_type === "see-also" && r.ticket_id === ticketB)).toBe(true);
    expect(relB.some((r) => r.relation_type === "see-also" && r.ticket_id === ticketA)).toBe(true);
  });

  // -- Guard rails --

  it("rejects self-relation", async () => {
    await expect(createRelation(db, projectId, ticketA, ticketA, "blocks")).rejects.toThrow(
      "cannot relate to itself"
    );
  });

  it("rejects duplicate relation", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await expect(createRelation(db, projectId, ticketA, ticketB, "blocks")).rejects.toThrow(
      "already exists"
    );
  });

  it("rejects unknown relation type", async () => {
    await expect(createRelation(db, projectId, ticketA, ticketB, "banana")).rejects.toThrow(
      "Unknown relation type"
    );
  });

  it("deleting a ticket removes all its relations", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await createRelation(db, projectId, ticketA, ticketC, "precedes");
    await deleteTicket(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    const relC = await listRelations(db, projectId, ticketC);
    expect(relB).toHaveLength(0);
    expect(relC).toHaveLength(0);
  });

  it("removes a relation and its inverse", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await removeRelation(db, projectId, ticketA, ticketB, "blocks");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    expect(relA).toHaveLength(0);
    expect(relB).toHaveLength(0);
  });

  it("lists correct count of relations", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await createRelation(db, projectId, ticketA, ticketC, "precedes");
    const relA = await listRelations(db, projectId, ticketA);
    // outgoing: blocks ticketB, precedes ticketC = 2 outgoing
    // But we also stored inverse rows that reference ticketA, so those show as incoming
    // For ticketA: outgoing blocks, outgoing precedes = 2
    expect(relA.filter((r) => r.direction === "outgoing")).toHaveLength(2);
  });

  // -- Symmetric dedup --

  it("symmetric relation (A,B) and (B,A) are the same", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "relates-to");
    await expect(createRelation(db, projectId, ticketB, ticketA, "relates-to")).rejects.toThrow(
      "already exists"
    );
  });
});
