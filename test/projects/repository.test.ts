import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import {
  createProject,
  listProjects,
  getProjectByName,
  deleteProject,
} from "../../src/projects/repository.js";

describe("projects repository", () => {
  let db: DB;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates a project", async () => {
    const project = await createProject(db, "Acme");
    assert.equal(project.name, "Acme");
    assert.notEqual(project.project_uuid, undefined);
    assert.ok(project.id > 0);
  });

  it("lists projects", async () => {
    await createProject(db, "Acme");
    await createProject(db, "Globex");
    const projects = await listProjects(db);
    assert.equal(projects.length, 2);
    assert.deepEqual(projects.map((p) => p.name), ["Acme", "Globex"]);
  });

  it("rejects duplicate project names", async () => {
    await createProject(db, "Acme");
    await assert.rejects(createProject(db, "Acme"));
  });

  it("gets a project by name", async () => {
    await createProject(db, "Acme");
    const project = await getProjectByName(db, "Acme");
    assert.notEqual(project, undefined);
    assert.equal(project!.name, "Acme");
  });

  it("returns undefined for non-existent project", async () => {
    const project = await getProjectByName(db, "NoSuchProject");
    assert.equal(project, undefined);
  });

  it("deletes a project", async () => {
    await createProject(db, "Acme");
    const deleted = await deleteProject(db, "Acme");
    assert.equal(deleted, true);
    const projects = await listProjects(db);
    assert.equal(projects.length, 0);
  });

  it("returns false when deleting non-existent project", async () => {
    const deleted = await deleteProject(db, "NoSuchProject");
    assert.equal(deleted, false);
  });
});
