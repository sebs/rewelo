import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
    expect(project.name).toBe("Acme");
    expect(project.project_uuid).toBeDefined();
    expect(project.id).toBeGreaterThan(0);
  });

  it("lists projects", async () => {
    await createProject(db, "Acme");
    await createProject(db, "Globex");
    const projects = await listProjects(db);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name)).toEqual(["Acme", "Globex"]);
  });

  it("rejects duplicate project names", async () => {
    await createProject(db, "Acme");
    await expect(createProject(db, "Acme")).rejects.toThrow();
  });

  it("gets a project by name", async () => {
    await createProject(db, "Acme");
    const project = await getProjectByName(db, "Acme");
    expect(project).toBeDefined();
    expect(project!.name).toBe("Acme");
  });

  it("returns undefined for non-existent project", async () => {
    const project = await getProjectByName(db, "NoSuchProject");
    expect(project).toBeUndefined();
  });

  it("deletes a project", async () => {
    await createProject(db, "Acme");
    const deleted = await deleteProject(db, "Acme");
    expect(deleted).toBe(true);
    const projects = await listProjects(db);
    expect(projects).toHaveLength(0);
  });

  it("returns false when deleting non-existent project", async () => {
    const deleted = await deleteProject(db, "NoSuchProject");
    expect(deleted).toBe(false);
  });
});
