import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { createProject } from "../../src/projects/repository.js";
import {
  getWeights,
  setWeights,
  resetWeights,
} from "../../src/weights/repository.js";

describe("weight configuration", () => {
  let db: DB;
  let projectId: number;

  beforeEach(async () => {
    db = await DB.open(":memory:");
    await migrate(db);
    const project = await createProject(db, "Acme");
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns defaults when no config exists", async () => {
    const config = await getWeights(db, projectId);
    expect(config.w1).toBe(1.5);
    expect(config.w2).toBe(1.5);
    expect(config.w3).toBe(1.5);
    expect(config.w4).toBe(1.5);
  });

  it("persists custom weights", async () => {
    await setWeights(db, projectId, 3.0, 1.0, 1.5, 2.0);
    const config = await getWeights(db, projectId);
    expect(config.w1).toBe(3.0);
    expect(config.w2).toBe(1.0);
    expect(config.w3).toBe(1.5);
    expect(config.w4).toBe(2.0);
  });

  it("updates existing weights", async () => {
    await setWeights(db, projectId, 3.0, 1.0, 1.5, 2.0);
    await setWeights(db, projectId, 2.0, 2.0, 1.0, 1.0);
    const config = await getWeights(db, projectId);
    expect(config.w1).toBe(2.0);
    expect(config.w2).toBe(2.0);
  });

  it("weights are scoped per project", async () => {
    const project2 = await createProject(db, "Globex");
    await setWeights(db, projectId, 3.0, 1.0, 1.5, 2.0);
    const config2 = await getWeights(db, project2.id);
    expect(config2.w1).toBe(1.5);
  });

  it("resets weights to defaults", async () => {
    await setWeights(db, projectId, 3.0, 1.0, 1.5, 2.0);
    const config = await resetWeights(db, projectId);
    expect(config.w1).toBe(1.5);
    expect(config.w2).toBe(1.5);
    const fromDb = await getWeights(db, projectId);
    expect(fromDb.w1).toBe(1.5);
  });

  it("rejects negative weights", async () => {
    await expect(
      setWeights(db, projectId, -1.0, 1.5, 1.5, 1.5)
    ).rejects.toThrow("non-negative");
  });

  it("allows zero weights when not both cost weights", async () => {
    await setWeights(db, projectId, 0, 1.5, 1.5, 1.5);
    const config = await getWeights(db, projectId);
    expect(config.w1).toBe(0);
  });

  it("allows w3=0 when w4 is non-zero", async () => {
    await setWeights(db, projectId, 1.5, 1.5, 0, 1.5);
    const config = await getWeights(db, projectId);
    expect(config.w3).toBe(0);
  });

  it("allows w4=0 when w3 is non-zero", async () => {
    await setWeights(db, projectId, 1.5, 1.5, 1.5, 0);
    const config = await getWeights(db, projectId);
    expect(config.w4).toBe(0);
  });

  it("rejects w3=0 and w4=0 simultaneously", async () => {
    await expect(
      setWeights(db, projectId, 1.5, 1.5, 0, 0)
    ).rejects.toThrow("w3 and w4 cannot both be zero");
  });
});
