import { DB } from "../db/connection.js";

export interface WeightConfig {
  project_id: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

const DEFAULTS: Omit<WeightConfig, "project_id"> = {
  w1: 1.5,
  w2: 1.5,
  w3: 1.5,
  w4: 1.5,
};

export async function getWeights(
  db: DB,
  projectId: number
): Promise<WeightConfig> {
  const rows = await db.all<WeightConfig>(
    `SELECT * FROM rw.weight_configs WHERE project_id = ?`,
    projectId
  );
  if (rows.length === 0) return { project_id: projectId, ...DEFAULTS };
  return rows[0];
}

export async function setWeights(
  db: DB,
  projectId: number,
  w1: number,
  w2: number,
  w3: number,
  w4: number
): Promise<WeightConfig> {
  validateWeights(w1, w2, w3, w4);

  const existing = await db.all(
    `SELECT 1 FROM rw.weight_configs WHERE project_id = ?`,
    projectId
  );

  if (existing.length > 0) {
    await db.run(
      `DELETE FROM rw.weight_configs WHERE project_id = ?`,
      projectId
    );
  }

  await db.run(
    `INSERT INTO rw.weight_configs (project_id, w1, w2, w3, w4) VALUES (?, ?, ?, ?, ?)`,
    projectId,
    w1,
    w2,
    w3,
    w4
  );

  return { project_id: projectId, w1, w2, w3, w4 };
}

export async function resetWeights(
  db: DB,
  projectId: number
): Promise<WeightConfig> {
  await db.run(
    `DELETE FROM rw.weight_configs WHERE project_id = ?`,
    projectId
  );
  return { project_id: projectId, ...DEFAULTS };
}

const MAX_WEIGHT = 100;

function validateWeights(w1: number, w2: number, w3: number, w4: number): void {
  for (const [name, val] of [["w1", w1], ["w2", w2], ["w3", w3], ["w4", w4]] as const) {
    if (typeof val !== "number" || val < 0) {
      throw new Error(`Weight ${name} must be a non-negative number`);
    }
    if (val > MAX_WEIGHT) {
      throw new Error(`Weight ${name} must not exceed ${MAX_WEIGHT}`);
    }
  }
}
