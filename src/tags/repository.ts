import { DB } from "../db/connection.js";
import { AppError, ValidationError } from "../validation/strings.js";

export interface Tag {
  id: number;
  project_id: number;
  prefix: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export async function createTag(
  db: DB,
  projectId: number,
  prefix: string,
  value: string
): Promise<Tag> {
  const existing = await getTag(db, projectId, prefix, value);
  if (existing) {
    throw new ValidationError(`Tag "${prefix}:${value}" already exists`);
  }

  const rows = await db.all<Tag>(
    `INSERT INTO rw.tags (project_id, prefix, value) VALUES (?, ?, ?) RETURNING *`,
    projectId,
    prefix,
    value
  );
  return rows[0];
}

export async function getTag(
  db: DB,
  projectId: number,
  prefix: string,
  value: string
): Promise<Tag | undefined> {
  const rows = await db.all<Tag>(
    `SELECT * FROM rw.tags WHERE project_id = ? AND prefix = ? AND value = ?`,
    projectId,
    prefix,
    value
  );
  return rows[0];
}

export async function getTagById(
  db: DB,
  projectId: number,
  tagId: number
): Promise<Tag | undefined> {
  const rows = await db.all<Tag>(
    `SELECT * FROM rw.tags WHERE project_id = ? AND id = ?`,
    projectId,
    tagId
  );
  return rows[0];
}

export async function listTags(db: DB, projectId: number): Promise<Tag[]> {
  return db.all<Tag>(
    `SELECT * FROM rw.tags WHERE project_id = ? ORDER BY prefix, value`,
    projectId
  );
}

export async function renameTag(
  db: DB,
  projectId: number,
  tagId: number,
  newPrefix: string,
  newValue: string
): Promise<Tag> {
  const current = await getTagById(db, projectId, tagId);
  if (!current) throw new AppError("Tag not found");

  const conflict = await getTag(db, projectId, newPrefix, newValue);
  if (conflict) {
    throw new ValidationError(`Tag "${newPrefix}:${newValue}" already exists`);
  }

  // Snapshot before change
  await db.run(
    `INSERT INTO rw.tag_revisions (tag_id, prefix, value) VALUES (?, ?, ?)`,
    tagId,
    current.prefix,
    current.value
  );

  const rows = await db.all<Tag>(
    `UPDATE rw.tags SET prefix = ?, value = ?, updated_at = now() WHERE id = ? AND project_id = ? RETURNING *`,
    newPrefix,
    newValue,
    tagId,
    projectId
  );
  return rows[0];
}

export async function deleteTag(
  db: DB,
  projectId: number,
  tagId: number
): Promise<boolean> {
  const tag = await getTagById(db, projectId, tagId);
  if (!tag) return false;

  // DuckDB: manual cascade (no FK on these child tables, so no transaction needed)
  await db.run(`DELETE FROM rw.ticket_tag_changes WHERE tag_id = ?`, tagId);
  await db.run(`DELETE FROM rw.ticket_tags WHERE tag_id = ?`, tagId);
  await db.run(`DELETE FROM rw.tag_revisions WHERE tag_id = ?`, tagId);
  await db.run(`DELETE FROM rw.tags WHERE id = ? AND project_id = ?`, tagId, projectId);
  return true;
}
