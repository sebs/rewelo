import { DB } from "../db/connection.js";
import { AppError } from "../validation/strings.js";

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
    `SELECT * FROM weight_configs WHERE project_id = ?`,
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

  // One upsert: select, delete and insert let parallel writers fail on the
  // unique project_id and readers see the defaults in between
  await db.run(
    `INSERT INTO weight_configs (project_id, w1, w2, w3, w4) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET w1 = excluded.w1, w2 = excluded.w2, w3 = excluded.w3, w4 = excluded.w4`,
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
    `DELETE FROM weight_configs WHERE project_id = ?`,
    projectId
  );
  return { project_id: projectId, ...DEFAULTS };
}

const MAX_WEIGHT = 100;
// A weight like 1e-22 makes weighted priorities astronomically large (2.1e+23)
// and prints as exponent notation; below 0.01 a weight is as good as 0.
const MIN_NONZERO_WEIGHT = 0.01;

export function validateWeights(w1: number, w2: number, w3: number, w4: number): void {
  for (const [name, val] of [["w1", w1], ["w2", w2], ["w3", w3], ["w4", w4]] as const) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
      throw new AppError(`Weight ${name} must be a non-negative number`);
    }
    if (val > MAX_WEIGHT) {
      throw new AppError(`Weight ${name} must not exceed ${MAX_WEIGHT}`);
    }
    if (val > 0 && val < MIN_NONZERO_WEIGHT) {
      throw new AppError(`Weight ${name} must be 0 or at least ${MIN_NONZERO_WEIGHT}`);
    }
  }
  if (w3 === 0 && w4 === 0) {
    throw new AppError("Cost weights w3 and w4 cannot both be zero (would cause division by zero in priority calculation)");
  }
}
