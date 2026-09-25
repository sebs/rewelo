import { DB, Row } from "../db/connection.js";
import { ValidationError } from "../errors.js";
import { normalizeName } from "../text.js";

export interface Project {
  id: number;
  project_uuid: string;
  name: string;
  created_at: string;
}

export async function createProject(db: DB, name: string): Promise<Project> {
  // One write transaction, so a process losing a race gets this message
  // rather than the database's generic unique-key error
  return db.transaction(async () => {
    const existing = await getProjectByName(db, name);
    if (existing) {
      throw new ValidationError(`A project named "${name}" already exists`);
    }
    const rows = await db.all<Project>(
      `INSERT INTO projects (name) VALUES (?) RETURNING *`,
      name
    );
    return rows[0];
  });
}

export async function listProjects(db: DB): Promise<Project[]> {
  return db.all<Project>(`SELECT * FROM projects ORDER BY name`);
}

export async function getProjectByName(
  db: DB,
  name: string
): Promise<Project | undefined> {
  const rows = await db.all<Project>(
    `SELECT * FROM projects WHERE name = ?`,
    normalizeName(name)
  );
  return rows[0];
}

export async function deleteProject(db: DB, name: string): Promise<boolean> {
  // All or nothing: a failure part-way (busy timeout, crash) must not leave
  // a half-deleted project, and a parallel ticket create must not slip in
  return db.transaction(async () => {
    const project = await getProjectByName(db, name);
    if (!project) return false;

    // The schema has no ON DELETE CASCADE, so we cascade manually.
    // Order matters: delete children before parents (foreign keys are enforced).
    const pid = project.id;
    await db.run(`DELETE FROM ticket_relations WHERE project_id = ?`, pid);
    await db.run(`DELETE FROM ticket_revisions WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)`, pid);
    await db.run(`DELETE FROM ticket_tag_changes WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)`, pid);
    await db.run(`DELETE FROM ticket_tags WHERE ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)`, pid);
    await db.run(`DELETE FROM tag_revisions WHERE tag_id IN (SELECT id FROM tags WHERE project_id = ?)`, pid);
    await db.run(`DELETE FROM tickets WHERE project_id = ?`, pid);
    await db.run(`DELETE FROM tags WHERE project_id = ?`, pid);
    await db.run(`DELETE FROM weight_configs WHERE project_id = ?`, pid);
    await db.run(`DELETE FROM ticket_deletions WHERE project_id = ?`, pid);
    await db.run(`DELETE FROM projects WHERE id = ?`, pid);
    return true;
  });
}
