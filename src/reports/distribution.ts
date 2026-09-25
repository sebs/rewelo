import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { DIMENSIONS, FIBONACCI } from "../domain/scores.js";

export interface DimensionDistribution {
  dimension: string;
  counts: Record<number, number>;
}

export async function getDistribution(
  db: DB,
  projectId: number
): Promise<DimensionDistribution[]> {
  const tickets = await listTickets(db, projectId, { withDescription: false });

  return DIMENSIONS.map((dimension) => {
    const counts: Record<number, number> = {};
    for (const fib of FIBONACCI) counts[fib] = 0;
    for (const t of tickets) {
      const val = t[dimension];
      counts[val] = (counts[val] || 0) + 1;
    }
    return { dimension, counts };
  });
}
