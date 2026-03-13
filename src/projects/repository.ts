import { DB, Row } from "../db/connection.js";

export interface Project {
  id: number;
  project_uuid: string;
  name: string;
  created_at: string;
}

export async function createProject(db: DB, name: string): Promise<Project> {
  const rows = await db.all<Project>(
    `INSERT INTO rw.projects (name) VALUES (?) RETURNING *`,
    name
  );
  return rows[0];
}

export async function listProjects(db: DB): Promise<Project[]> {
  return db.all<Project>(`SELECT * FROM rw.projects ORDER BY name`);
}

export async function getProjectByName(
  db: DB,
  name: string
): Promise<Project | undefined> {
  const rows = await db.all<Project>(
    `SELECT * FROM rw.projects WHERE name = ?`,
    name
  );
  return rows[0];
}

export async function getProjectById(
  db: DB,
  id: number
): Promise<Project | undefined> {
  const rows = await db.all<Project>(
    `SELECT * FROM rw.projects WHERE id = ?`,
    id
  );
  return rows[0];
}

export async function deleteProject(db: DB, name: string): Promise<boolean> {
  const project = await getProjectByName(db, name);
  if (!project) return false;

  // DuckDB does not support ON DELETE CASCADE, so we cascade manually.
  // Order matters: delete children before parents.
  await db.run(`DELETE FROM rw.ticket_relations WHERE project_id = ?`, project.id);
  await db.run(`DELETE FROM rw.ticket_revisions WHERE ticket_id IN (SELECT id FROM rw.tickets WHERE project_id = ?)`, project.id);
  await db.run(`DELETE FROM rw.ticket_tag_changes WHERE ticket_id IN (SELECT id FROM rw.tickets WHERE project_id = ?)`, project.id);
  await db.run(`DELETE FROM rw.ticket_tags WHERE ticket_id IN (SELECT id FROM rw.tickets WHERE project_id = ?)`, project.id);
  await db.run(`DELETE FROM rw.tag_revisions WHERE tag_id IN (SELECT id FROM rw.tags WHERE project_id = ?)`, project.id);
  await db.run(`DELETE FROM rw.tickets WHERE project_id = ?`, project.id);
  await db.run(`DELETE FROM rw.tags WHERE project_id = ?`, project.id);
  await db.run(`DELETE FROM rw.projects WHERE id = ?`, project.id);
  return true;
}
