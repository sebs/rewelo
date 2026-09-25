import { DB } from "../db/connection.js";
import { DEFAULT_WEIGHTS as DEFAULTS, validateWeights, type Weights } from "../domain/weights.js";

export interface WeightConfig extends Weights {
  project_id: number;
}

export async function getWeights(
  db: DB,
  projectId: number
): Promise<WeightConfig> {
  const rows = await db.all<WeightConfig>(
    `SELECT * FROM weight_configs WHERE project_id = ?`,
    projectId
  );
  if (rows.length === 0) return { project_id: projectId, ...DEFAULTS };
  return rows[0];
}

export async function setWeights(
  db: DB,
  projectId: number,
  weights: Weights
): Promise<WeightConfig> {
  validateWeights(weights);
  const { w1, w2, w3, w4 } = weights;

  // One upsert: select, delete and insert let parallel writers fail on the
  // unique project_id and readers see the defaults in between. In a
  // transaction like every write, so the MCP server sees it committed
  await db.transaction(() => db.run(
    `INSERT INTO weight_configs (project_id, w1, w2, w3, w4) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET w1 = excluded.w1, w2 = excluded.w2, w3 = excluded.w3, w4 = excluded.w4`,
    projectId,
    w1,
    w2,
    w3,
    w4
  ));

  return { project_id: projectId, w1, w2, w3, w4 };
}

export async function resetWeights(
  db: DB,
  projectId: number
): Promise<WeightConfig> {
  await db.transaction(() => db.run(`DELETE FROM weight_configs WHERE project_id = ?`, projectId));
  return { project_id: projectId, ...DEFAULTS };
}
