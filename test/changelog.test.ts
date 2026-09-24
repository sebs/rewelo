import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  it("lists breaking changes first, and perf and test commits in their own sections", () => {
    commit("feat(db)!: new storage");
    commit("perf: faster");
    commit("test: more tests");
    const out = changelog();
    assert.match(out, /### Breaking Changes\n\n- feat: new storage/);
    assert.match(out, /### Performance\n\n- faster/);
    assert.match(out, /### Tests\n\n- more tests/);
    assert.doesNotMatch(out, /### Other/);
  });

  it("replaces an existing entry for the same version instead of adding another", () => {
    changelog("v1.0.0");
    changelog();
    changelog();
    const text = readFileSync(join(repo, "CHANGELOG.md"), "utf-8");
    assert.equal(text.match(/^## Unreleased$/gm)?.length, 1);
    assert.equal(text.match(/^## 1\.0\.0$/gm)?.length, 1);
  });

  it("fails clearly for an unknown tag", () => {
    assert.throws(() => changelog("v9.9.9"), (err: { stderr: Buffer }) => /Unknown tag "v9.9.9"/.test(String(err.stderr)));
  });

  it("--all writes an entry for every tag, leaving out version bump commits", () => {
    commit("1.1.0");
    git("tag", "v1.1.0");
    execFileSync(process.execPath, [SCRIPT, "--all"], { cwd: repo, stdio: "pipe" });
    const text = readFileSync(join(repo, "CHANGELOG.md"), "utf-8");
    assert.match(text, /^# Changelog\n\n## 1\.1\.0\n\n- after the release\n\n## 1\.0\.0\n\n- first feature\n/);
    assert.doesNotMatch(text, /- 1\.1\.0/);
  });
});
