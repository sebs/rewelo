import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";
import { getDistribution } from "../../src/reports/distribution.js";

describe("distribution report", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "DistTest");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns all-zero counts for empty project", async () => {
    const dist = await getDistribution(db, projectId);
    expect(dist).toHaveLength(4);
    for (const d of dist) {
      expect(Object.values(d.counts).every((c) => c === 0)).toBe(true);
    }
  });

  it("counts tickets per Fibonacci value per dimension", async () => {
    await createTicket(db, { projectId, title: "A", benefit: 5, penalty: 3, estimate: 8, risk: 1 });
    await createTicket(db, { projectId, title: "B", benefit: 5, penalty: 8, estimate: 3, risk: 1 });

    const dist = await getDistribution(db, projectId);
    const benefit = dist.find((d) => d.dimension === "benefit")!;
    expect(benefit.counts[5]).toBe(2);
    expect(benefit.counts[1]).toBe(0);

    const risk = dist.find((d) => d.dimension === "risk")!;
    expect(risk.counts[1]).toBe(2);
  });
});
