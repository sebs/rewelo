import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import {
  createTag,
  getTag,
  listTags,
  renameTag,
  deleteTag,
} from "../../src/tags/repository.js";

describe("tags repository", () => {
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

  it("creates a tag", async () => {
    const tag = await createTag(db, projectId, "state", "backlog");
    expect(tag.prefix).toBe("state");
    expect(tag.value).toBe("backlog");
    expect(tag.project_id).toBe(projectId);
  });

  it("rejects duplicate tags in the same project", async () => {
    await createTag(db, projectId, "state", "backlog");
    await expect(createTag(db, projectId, "state", "backlog")).rejects.toThrow();
  });

  it("allows same tag in different projects", async () => {
    const project2 = await createProject(db, "Globex");
    await createTag(db, projectId, "state", "backlog");
    const tag2 = await createTag(db, project2.id, "state", "backlog");
    expect(tag2.project_id).toBe(project2.id);
  });

  it("gets a tag by prefix and value", async () => {
    await createTag(db, projectId, "state", "backlog");
    const tag = await getTag(db, projectId, "state", "backlog");
    expect(tag).toBeDefined();
    expect(tag!.prefix).toBe("state");
  });

  it("returns undefined for non-existent tag", async () => {
    const tag = await getTag(db, projectId, "state", "backlog");
    expect(tag).toBeUndefined();
  });

  it("lists tags ordered by prefix and value", async () => {
    await createTag(db, projectId, "state", "wip");
    await createTag(db, projectId, "feature", "auth");
    await createTag(db, projectId, "state", "backlog");
    const tags = await listTags(db, projectId);
    expect(tags.map((t) => `${t.prefix}:${t.value}`)).toEqual([
      "feature:auth",
      "state:backlog",
      "state:wip",
    ]);
  });

  it("renames a tag and creates a revision", async () => {
    const tag = await createTag(db, projectId, "feature", "login");
    const renamed = await renameTag(db, projectId, tag.id, "feature", "auth");
    expect(renamed.value).toBe("auth");

    const revisions = await db.all(
      "SELECT * FROM rw.tag_revisions WHERE tag_id = ?",
      tag.id
    );
    expect(revisions).toHaveLength(1);
    expect((revisions[0] as any).prefix).toBe("feature");
    expect((revisions[0] as any).value).toBe("login");
  });

  it("deletes a tag", async () => {
    const tag = await createTag(db, projectId, "state", "backlog");
    const deleted = await deleteTag(db, projectId, tag.id);
    expect(deleted).toBe(true);
    const tags = await listTags(db, projectId);
    expect(tags).toHaveLength(0);
  });
});
