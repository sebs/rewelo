import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(tag.prefix, "state");
    assert.equal(tag.value, "backlog");
    assert.equal(tag.project_id, projectId);
  });

  it("rejects duplicate tags in the same project", async () => {
    await createTag(db, projectId, "state", "backlog");
    await assert.rejects(createTag(db, projectId, "state", "backlog"));
  });

  it("allows same tag in different projects", async () => {
    const project2 = await createProject(db, "Globex");
    await createTag(db, projectId, "state", "backlog");
    const tag2 = await createTag(db, project2.id, "state", "backlog");
    assert.equal(tag2.project_id, project2.id);
  });

  it("gets a tag by prefix and value", async () => {
    await createTag(db, projectId, "state", "backlog");
    const tag = await getTag(db, projectId, "state", "backlog");
    assert.notEqual(tag, undefined);
    assert.equal(tag!.prefix, "state");
  });

  it("returns undefined for non-existent tag", async () => {
    const tag = await getTag(db, projectId, "state", "backlog");
    assert.equal(tag, undefined);
  });

  it("lists tags ordered by prefix and value", async () => {
    await createTag(db, projectId, "state", "wip");
    await createTag(db, projectId, "feature", "auth");
    await createTag(db, projectId, "state", "backlog");
    const tags = await listTags(db, projectId);
    assert.deepEqual(tags.map((t) => `${t.prefix}:${t.value}`), [
      "feature:auth",
      "state:backlog",
      "state:wip",
    ]);
  });

  it("renames a tag and creates a revision", async () => {
    const tag = await createTag(db, projectId, "feature", "login");
    const renamed = await renameTag(db, projectId, tag.id, "feature", "auth");
    assert.equal(renamed.value, "auth");

    const revisions = await db.all(
      "SELECT * FROM tag_revisions WHERE tag_id = ?",
      tag.id
    );
    assert.equal(revisions.length, 1);
    assert.equal((revisions[0] as any).prefix, "feature");
    assert.equal((revisions[0] as any).value, "login");
  });

  it("deletes a tag", async () => {
    const tag = await createTag(db, projectId, "state", "backlog");
    const deleted = await deleteTag(db, projectId, tag.id);
    assert.equal(deleted, true);
    const tags = await listTags(db, projectId);
    assert.equal(tags.length, 0);
  });
});
