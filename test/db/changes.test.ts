import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB } from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { DataChanges } from "../../src/db/changes.js";
import { createProject } from "../../src/projects/repository.js";
import { createTicket } from "../../src/tickets/repository.js";

describe("DataChanges", () => {
  let dir: string;
  let reader: DB;
  let writer: DB;
  const now = new Date("2026-03-10T12:00:00Z");

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rewelo-changes-"));
    const path = join(dir, "rw.db");
    reader = await DB.open(path);
    await migrate(reader);
    writer = await DB.open(path);
  });

  afterEach(async () => {
    await reader.close();
    await writer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stays the same while nothing changes", async () => {
    const changes = new DataChanges();
    const first = await changes.version(reader, now);
    assert.equal(await changes.version(reader, now), first);
  });

  it("changes when another connection commits", async () => {
    const changes = new DataChanges();
    const before = await changes.version(reader, now);
    await createProject(writer, "Elsewhere");
    const after = await changes.version(reader, now);
    assert.notEqual(after, before);
    assert.equal(await changes.version(reader, now), after);
  });

  it("changes when its own connection writes, which data_version misses", async () => {
    const changes = new DataChanges();
    const project = await createProject(reader, "Here");
    const before = await changes.version(reader, now);
    await createTicket(reader, { projectId: project.id, title: "New" });
    assert.notEqual(await changes.version(reader, now), before);
  });

  it("changes with the day, as the cumulative flow ends today", async () => {
    const changes = new DataChanges();
    const today = await changes.version(reader, now);
    assert.notEqual(await changes.version(reader, new Date("2026-03-11T00:00:01Z")), today);
  });

  it("never repeats another run's tokens", async () => {
    assert.notEqual(await new DataChanges().version(reader, now), await new DataChanges().version(reader, now));
  });
});
