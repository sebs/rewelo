import { DB } from "../db/connection.js";
import { listTickets } from "../tickets/repository.js";
import { FIBONACCI_VALUES } from "../db/types.js";

export interface DimensionDistribution {
  dimension: string;
  counts: Record<number, number>;
}

export async function getDistribution(
  db: DB,
  projectId: number
): Promise<DimensionDistribution[]> {
  const tickets = await listTickets(db, projectId);

  const dimensions: Array<{ name: string; key: "benefit" | "penalty" | "estimate" | "risk" }> = [
    { name: "benefit", key: "benefit" },
    { name: "penalty", key: "penalty" },
    { name: "estimate", key: "estimate" },
    { name: "risk", key: "risk" },
  ];

  return dimensions.map((dim) => {
    const counts: Record<number, number> = {};
    for (const fib of FIBONACCI_VALUES) counts[fib] = 0;
    for (const t of tickets) {
      const val = t[dim.key];
      counts[val] = (counts[val] || 0) + 1;
    }
    return { dimension: dim.name, counts };
  });
}
