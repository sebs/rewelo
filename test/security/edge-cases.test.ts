import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket, listTickets } from "../../src/tickets/repository.js";
import { priority } from "../../src/calculations/priority.js";
import {
  calculateRelativeWeights,
  Scoreable,
} from "../../src/calculations/relative-weights.js";
import { weightedPriority } from "../../src/calculations/weighted-priority.js";
import { getTicketTimes, averageLeadTime } from "../../src/calculations/time.js";

describe("edge cases", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "EdgeCase");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("empty project: listTickets returns empty", async () => {
    const tickets = await listTickets(db, projectId);
    expect(tickets).toHaveLength(0);
  });

  it("empty project: averageLeadTime returns undefined", () => {
    expect(averageLeadTime([])).toBeUndefined();
  });

  it("single ticket: relative weights are all 1.00", () => {
    const ticket: Scoreable = { benefit: 5, penalty: 3, estimate: 8, risk: 2 };
    const weights = calculateRelativeWeights(ticket, [ticket]);
    expect(weights.relativeBenefit).toBe(1);
    expect(weights.relativePenalty).toBe(1);
    expect(weights.relativeEstimate).toBe(1);
    expect(weights.relativeRisk).toBe(1);
  });

  it("max Fibonacci: value 42, cost 42, priority 1.00", () => {
    const p = priority(21, 21, 21, 21);
    expect(p).toBe(1);
  });

  it("min Fibonacci: value 2, cost 2, priority 1.00", () => {
    const p = priority(1, 1, 1, 1);
    expect(p).toBe(1);
  });

  it("zero denominator weights throws clear error", () => {
    expect(() => weightedPriority(5, 3, 1, 1, 1, 1, 0, 0)).toThrow(
      "denominator is zero"
    );
  });

  it("all zeros in relative weights returns 0", () => {
    const ticket: Scoreable = { benefit: 0, penalty: 0, estimate: 0, risk: 0 };
    const weights = calculateRelativeWeights(ticket, [ticket]);
    expect(weights.relativeBenefit).toBe(0);
    expect(weights.relativePenalty).toBe(0);
  });

  it("ticket times with no state tags returns undefined times", async () => {
    const ticket = await createTicket(db, { projectId, title: "Bare" });
    const times = await getTicketTimes(db, ticket.id);
    expect(times.leadTimeDays).toBeUndefined();
    expect(times.cycleTimeDays).toBeUndefined();
  });
});
