import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMountPoint, warnIfNoVolume } from "../src/volume.js";

function stderrOf(fn: () => void): string {
  const original = console.error;
  let out = "";
  console.error = (...args: unknown[]) => {
    out += args.join(" ");
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return out;
}

describe("data volume warning", () => {
  it("tells mount points from plain directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-vol-"));
    try {
      assert.equal(isMountPoint(dir), false);
      assert.equal(isMountPoint("/dev"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns when the database is in RW_DATA_VOLUME and nothing is mounted there", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-vol-"));
    try {
      const out = stderrOf(() => warnIfNoVolume(join(dir, "rw.db"), { RW_DATA_VOLUME: dir }));
      assert.match(out, /no volume is mounted/);
      assert.match(out, /-v rw-data:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stays quiet outside a container, elsewhere, or with a volume", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-vol-"));
    try {
      assert.equal(stderrOf(() => warnIfNoVolume(join(dir, "rw.db"), {})), "");
      assert.equal(stderrOf(() => warnIfNoVolume("/elsewhere/rw.db", { RW_DATA_VOLUME: dir })), "");
      assert.equal(stderrOf(() => warnIfNoVolume(":memory:", { RW_DATA_VOLUME: dir })), "");
      assert.equal(stderrOf(() => warnIfNoVolume("/dev/rw.db", { RW_DATA_VOLUME: "/dev" })), "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
