import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMountPoint, mountedBetween, warnIfNoVolume } from "../src/volume.js";

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

  it("warns for a database reached through a symbolic link, and for RW_DATA_VOLUME=/", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-vol-"));
    try {
      mkdirSync(join(dir, "vol"));
      symlinkSync(join(dir, "vol"), join(dir, "link"));
      assert.match(stderrOf(() => warnIfNoVolume(join(dir, "link", "rw.db"), { RW_DATA_VOLUME: join(dir, "vol") })), /no volume/);
      // Without a mount on the way, everything is on the root's device
      assert.equal(mountedBetween(join(dir, "vol", "rw.db"), "/", () => false), false);
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

  it("counts a volume mounted below RW_DATA_VOLUME or on the database file", () => {
    const mounts = (...paths: string[]) => (path: string) => paths.includes(path);
    assert.equal(mountedBetween("/data/sub/rw.db", "/data", mounts("/data/sub")), true);
    assert.equal(mountedBetween("/data/rw.db", "/data", mounts("/data")), true);
    assert.equal(mountedBetween("/data/sub/rw.db", "/data", mounts()), false);
    const dir = mkdtempSync(join(tmpdir(), "rw-vol-"));
    try {
      const file = join(dir, "rw.db");
      writeFileSync(file, "");
      assert.equal(mountedBetween(file, dir, mounts(file)), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Mounts above RW_DATA_VOLUME don't count
    assert.equal(mountedBetween("/data/sub/rw.db", "/data", mounts("/")), false);
  });
});
