import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { createRelation } from "../../src/relations/repository.js";
import { assignTag } from "../../src/tags/assignment.js";
import { createTag } from "../../src/tags/repository.js";
import { openBlockers } from "../../src/relations/blocking.js";

describe("open blockers", () => {
  let db: DB;
  let projectId: number;
  const id: Record<string, number> = {};

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    projectId = (await createProject(db, "Acme")).id;
    for (const title of ["Auth", "Login", "Signup", "Docs", "Launch"]) id[title] = (await createTicket(db, { projectId, title })).id;
  });

  afterEach(async () => {
    await db.close();
  });

  const titles = async () => Object.fromEntries([...(await openBlockers(db, projectId))].map(([ticket, blockers]) => [Object.keys(id).find((t) => id[t] === ticket), blockers]));

  it("finds the tickets that block a ticket or that it depends on", async () => {
    await createRelation(db, projectId, id.Auth, id.Login, "blocks");
    await createRelation(db, projectId, id.Signup, id.Auth, "depends-on");
    await createRelation(db, projectId, id.Docs, id.Login, "blocks");
    assert.deepEqual(await titles(), { Login: ["Auth", "Docs"], Signup: ["Auth"] });
  });

  it("accepts the inverse names, as they are stored as the forward relation", async () => {
    await createRelation(db, projectId, id.Login, id.Auth, "is-blocked-by");
    await createRelation(db, projectId, id.Auth, id.Signup, "is-depended-on-by");
    assert.deepEqual(await titles(), { Login: ["Auth"], Signup: ["Auth"] });
  });

  it("doesn't count a blocker that is done, nor mark a done ticket as blocked", async () => {
    const done = await createTag(db, projectId, "state", "done");
    await createRelation(db, projectId, id.Auth, id.Login, "blocks");
    await createRelation(db, projectId, id.Docs, id.Launch, "blocks");
    await assignTag(db, id.Auth, done.id);
    await assignTag(db, id.Launch, done.id);
    assert.deepEqual(await titles(), {});
  });

  it("leaves out relations that only order or relate tickets", async () => {
    await createRelation(db, projectId, id.Auth, id.Login, "precedes");
    await createRelation(db, projectId, id.Auth, id.Signup, "relates-to");
    await createRelation(db, projectId, id.Docs, id.Launch, "splits-into");
    assert.deepEqual(await titles(), {});
  });
});
