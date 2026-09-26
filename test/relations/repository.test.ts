import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, deleteTicket } from "../../src/tickets/repository.js";
import {
  createRelation,
  removeRelation,
  listRelations,
  listProjectRelations,
} from "../../src/relations/repository.js";

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
    assert.equal(relA.some((r) => r.relation_type === "blocks" && r.ticket_id === ticketB), true);
    assert.equal(relB.some((r) => r.relation_type === "is-blocked-by" && r.ticket_id === ticketA), true);
  });

  it("rejects an asymmetric relation that reverses an existing one", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await assert.rejects(createRelation(db, projectId, ticketB, ticketA, "blocks"), /reverse relation already exists/);
    // Named as it exists, whichever name the new one used
    await assert.rejects(createRelation(db, projectId, ticketA, ticketB, "is-blocked-by"), /reverse relation already exists: "Auth service" blocks "Login page"/);
    // Symmetric relations have no direction to contradict
    await createRelation(db, projectId, ticketA, ticketB, "relates-to");
  });

  it("rejects an order that contradicts one stated with another type", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await assert.rejects(createRelation(db, projectId, ticketA, ticketB, "depends-on"), /contradicts an existing relation: "Auth service" blocks "Login page"/);
    await assert.rejects(createRelation(db, projectId, ticketB, ticketA, "precedes"), /contradicts/);
    await assert.rejects(createRelation(db, projectId, ticketB, ticketA, "is-depended-on-by"), /contradicts/);
    // The same order in other words is fine
    await createRelation(db, projectId, ticketB, ticketA, "depends-on");
    await createRelation(db, projectId, ticketA, ticketB, "precedes");
  });

  it("rejects an order that closes a cycle through other tickets", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await createRelation(db, projectId, ticketC, ticketB, "depends-on"); // B before C
    await assert.rejects(
      createRelation(db, projectId, ticketC, ticketA, "precedes"),
      /would close a cycle with the existing relations "Auth service" blocks "Login page", "Signup flow" depends-on "Login page"/
    );
    await assert.rejects(createRelation(db, projectId, ticketA, ticketC, "depends-on"), /would close a cycle/);
    // The same order, or relations that order nothing, are fine
    await createRelation(db, projectId, ticketA, ticketC, "precedes");
    await createRelation(db, projectId, ticketC, ticketA, "relates-to");
  });

  it("creates depends-on / is-depended-on-by", async () => {
    await createRelation(db, projectId, ticketB, ticketA, "depends-on");
    const relB = await listRelations(db, projectId, ticketB);
    const relA = await listRelations(db, projectId, ticketA);
    assert.equal(relB.some((r) => r.relation_type === "depends-on"), true);
    assert.equal(relA.some((r) => r.relation_type === "is-depended-on-by"), true);
  });

  // -- Logical / Semantic --

  it("creates relates-to (symmetric)", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "relates-to");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relA.some((r) => r.relation_type === "relates-to" && r.ticket_id === ticketB), true);
    assert.equal(relB.some((r) => r.relation_type === "relates-to" && r.ticket_id === ticketA), true);
  });

  it("creates duplicates / is-duplicated-by", async () => {
    await createRelation(db, projectId, ticketC, ticketB, "duplicates");
    const relC = await listRelations(db, projectId, ticketC);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relC.some((r) => r.relation_type === "duplicates"), true);
    assert.equal(relB.some((r) => r.relation_type === "is-duplicated-by"), true);
  });

  it("creates supersedes / is-superseded-by", async () => {
    await createRelation(db, projectId, ticketC, ticketB, "supersedes");
    const relC = await listRelations(db, projectId, ticketC);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relC.some((r) => r.relation_type === "supersedes"), true);
    assert.equal(relB.some((r) => r.relation_type === "is-superseded-by"), true);
  });

  // -- Temporal --

  it("creates precedes / follows", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "precedes");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relA.some((r) => r.relation_type === "precedes"), true);
    assert.equal(relB.some((r) => r.relation_type === "follows"), true);
  });

  // -- Scope / Verification --

  it("creates tests / is-tested-by", async () => {
    await createRelation(db, projectId, ticketC, ticketA, "tests");
    const relC = await listRelations(db, projectId, ticketC);
    const relA = await listRelations(db, projectId, ticketA);
    assert.equal(relC.some((r) => r.relation_type === "tests"), true);
    assert.equal(relA.some((r) => r.relation_type === "is-tested-by"), true);
  });

  it("creates implements / is-implemented-by", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "implements");
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relB.some((r) => r.relation_type === "is-implemented-by"), true);
  });

  it("creates addresses / is-addressed-by", async () => {
    await createRelation(db, projectId, ticketB, ticketA, "addresses");
    const relA = await listRelations(db, projectId, ticketA);
    assert.equal(relA.some((r) => r.relation_type === "is-addressed-by"), true);
  });

  // -- Effort / Scope --

  it("creates splits-into / is-split-from", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "splits-into");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relA.some((r) => r.relation_type === "splits-into"), true);
    assert.equal(relB.some((r) => r.relation_type === "is-split-from"), true);
  });

  // -- Knowledge / Reference --

  it("creates informs / is-informed-by", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "informs");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relA.some((r) => r.relation_type === "informs"), true);
    assert.equal(relB.some((r) => r.relation_type === "is-informed-by"), true);
  });

  it("creates see-also (symmetric)", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "see-also");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relA.some((r) => r.relation_type === "see-also" && r.ticket_id === ticketB), true);
    assert.equal(relB.some((r) => r.relation_type === "see-also" && r.ticket_id === ticketA), true);
  });

  // -- Guard rails --

  it("rejects self-relation", async () => {
    await assert.rejects(createRelation(db, projectId, ticketA, ticketA, "blocks"), /cannot relate to itself/);
  });

  it("rejects duplicate relation", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await assert.rejects(createRelation(db, projectId, ticketA, ticketB, "blocks"), /already exists/);
  });

  it("rejects unknown relation type", async () => {
    await assert.rejects(createRelation(db, projectId, ticketA, ticketB, "banana"), /Unknown relation type/);
  });

  it("deleting a ticket removes all its relations", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await createRelation(db, projectId, ticketA, ticketC, "precedes");
    await deleteTicket(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    const relC = await listRelations(db, projectId, ticketC);
    assert.equal(relB.length, 0);
    assert.equal(relC.length, 0);
  });

  it("removes a relation and its inverse", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await removeRelation(db, projectId, ticketA, ticketB, "blocks");
    const relA = await listRelations(db, projectId, ticketA);
    const relB = await listRelations(db, projectId, ticketB);
    assert.equal(relA.length, 0);
    assert.equal(relB.length, 0);
  });

  it("lists correct count of relations", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await createRelation(db, projectId, ticketA, ticketC, "precedes");
    const relA = await listRelations(db, projectId, ticketA);
    // outgoing: blocks ticketB, precedes ticketC = 2 outgoing
    // But we also stored inverse rows that reference ticketA, so those show as incoming
    // For ticketA: outgoing blocks, outgoing precedes = 2
    assert.equal((relA.filter((r) => r.direction === "outgoing")).length, 2);
  });

  it("accepts relation types in any case, like tag names", async () => {
    const r = await createRelation(db, projectId, ticketA, ticketB, " Blocks ");
    assert.equal(r.relation_type, "blocks");
    assert.equal(await removeRelation(db, projectId, ticketB, ticketA, "IS-BLOCKED-BY"), true);
  });

  it("reports the same relation id from both tickets, as listed project-wide", async () => {
    const created = await createRelation(db, projectId, ticketB, ticketA, "blocks");
    const [fromA] = await listRelations(db, projectId, ticketA);
    const [fromB] = await listRelations(db, projectId, ticketB);
    assert.deepEqual([fromA.id, fromB.id], [created.id, created.id]);
    assert.equal((await listProjectRelations(db, projectId))[0].id, created.id);
  });

  it("shows relations another ticket holds as incoming, and symmetric ones as both", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await createRelation(db, projectId, ticketC, ticketA, "blocks");
    await createRelation(db, projectId, ticketC, ticketA, "relates-to");

    const view = (await listRelations(db, projectId, ticketA)).map((r) => [r.relation_type, r.direction, r.ticket_id]);
    assert.deepEqual(view.sort(), [
      ["blocks", "outgoing", ticketB],
      ["is-blocked-by", "incoming", ticketC],
      ["relates-to", "both", ticketC],
    ].sort());
  });

  // -- Symmetric dedup --

  it("symmetric relation (A,B) and (B,A) are the same", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "relates-to");
    await assert.rejects(createRelation(db, projectId, ticketB, ticketA, "relates-to"), /already exists/);
  });

  it("lists each asymmetric relation once project-wide", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    const all = await listProjectRelations(db, projectId);
    assert.deepEqual(all.map((r) => [r.source_id, r.relation_type, r.target_id]), [[ticketA, "blocks", ticketB]]);
  });

  it("accepts the inverse name it lists when removing", async () => {
    await createRelation(db, projectId, ticketA, ticketB, "blocks");
    await removeRelation(db, projectId, ticketB, ticketA, "is-blocked-by");
    assert.equal((await listRelations(db, projectId, ticketA)).length, 0);
    assert.equal((await listRelations(db, projectId, ticketB)).length, 0);
  });

  it("accepts inverse names when creating, as the forward relation", async () => {
    await createRelation(db, projectId, ticketB, ticketA, "is-blocked-by");
    const all = await listProjectRelations(db, projectId);
    assert.deepEqual(all.map((r) => [r.source_id, r.relation_type, r.target_id]), [[ticketA, "blocks", ticketB]]);
    await assert.rejects(createRelation(db, projectId, ticketA, ticketB, "blocks"), /already exists/);
  });
});
