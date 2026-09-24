import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// build/test -> repository root
const SCRIPT = resolve(__dirname, "../../scripts/changelog.mjs");

describe("scripts/changelog.mjs", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString();
  const commit = (message: string) => git("commit", "-q", "--allow-empty", "-m", message);
  const changelog = (...args: string[]) =>
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: repo, stdio: "pipe" }).toString();

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rw-changelog-"));
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    commit("feat: first feature");
    git("tag", "v1.0.0");
    commit("fix: after the release");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("without a tag lists the commits since the latest release as Unreleased", () => {
    const out = changelog();
    assert.match(out, /^## Unreleased/);
    assert.match(out, /- after the release/);
    assert.doesNotMatch(out, /first feature/);
  });

  it("with a tag lists that release's commits", () => {
    assert.match(changelog("v1.0.0"), /^## 1\.0\.0[\s\S]*- first feature/);
  });
});
