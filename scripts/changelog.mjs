#!/usr/bin/env node
/**
 * Generate changelog entries from git log between tags.
 *
 * Usage:
 *   node scripts/changelog.mjs              # latest tag → HEAD, as "Unreleased"
 *   node scripts/changelog.mjs v0.3.5       # previous tag → v0.3.5
 *   node scripts/changelog.mjs --all        # rebuild CHANGELOG.md for every tag
 *
 * A single entry is printed and added to CHANGELOG.md (replacing an entry for
 * the same version). --all rewrites CHANGELOG.md with one entry per tag, so
 * the file attached to a release covers every version, not only the latest.
 *
 * Commits are grouped by conventional-commit prefix (feat, fix, etc.).
 * Commits without a recognised prefix go under "Other"; version bump commits
 * ("0.6.1", as `npm version` writes them) are left out.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const tags = execSync("git tag --sort=-version:refname").toString().trim().split("\n").filter(Boolean);

const labels = {
  breaking: "Breaking Changes",
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Documentation",
  test: "Tests",
  chore: "Chores",
  other: "Other",
};

// The changelog entry for the commits in `range`, or undefined if there are none
function entryFor(version, range) {
  const log = execSync(`git log ${range} --pretty=format:"%s" --no-merges`).toString().trim();
  const groups = Object.fromEntries(Object.keys(labels).map((key) => [key, []]));
  for (const line of log.split("\n").filter(Boolean)) {
    if (/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(line.trim())) continue; // version bump
    // type(scope)!: subject, where "!" marks a breaking change
    const match = line.match(/^(\w+)(?:\(.+?\))?(!)?:\s*(.+)/);
    if (match && match[2]) {
      groups.breaking.push(`${match[1]}: ${match[3].trim()}`);
    } else if (match && groups[match[1]]) {
      groups[match[1]].push(match[3].trim());
    } else {
      groups.other.push(line.trim());
    }
  }
  const filled = Object.entries(groups).filter(([, items]) => items.length > 0);
  if (filled.length === 0) return undefined;

  let entry = `## ${version}\n\n`;
  for (const [key, items] of filled) {
    if (filled.length > 1) entry += `### ${labels[key]}\n\n`;
    for (const item of items) entry += `- ${item}\n`;
    entry += "\n";
  }
  return entry;
}

// The range of commits a tag released: from the tag before it
function rangeFor(tag) {
  const index = tags.indexOf(tag);
  const previous = index < tags.length - 1 ? tags[index + 1] : "";
  return previous ? `${previous}..${tag}` : tag;
}

const changelogPath = "CHANGELOG.md";

if (process.argv[2] === "--all") {
  const entries = tags.map((tag) => entryFor(tag.replace(/^v/, ""), rangeFor(tag))).filter(Boolean);
  writeFileSync(changelogPath, `# Changelog\n\n${entries.join("")}`);
  console.error(`Wrote ${changelogPath} with ${entries.length} versions`);
  process.exit(0);
}

let version;
let range;
if (process.argv[2] === undefined) {
  // What has happened since the latest release
  version = "Unreleased";
  range = tags.length > 0 ? `${tags[0]}..HEAD` : "HEAD";
} else {
  const tag = process.argv[2];
  version = tag.replace(/^v/, "");
  const vTag = tag.startsWith("v") ? tag : `v${tag}`;
  if (!tags.includes(vTag)) {
    console.error(`Unknown tag "${tag}". Known tags: ${tags.slice(0, 5).join(", ")}${tags.length > 5 ? ", ..." : ""}`);
    process.exit(1);
  }
  range = rangeFor(vTag);
}

const entry = entryFor(version, range);
if (!entry) {
  console.error("No commits found.");
  process.exit(1);
}

// Add to CHANGELOG.md, replacing an entry for the same version (running the
// script twice used to add a second one)
if (existsSync(changelogPath)) {
  const existing = readFileSync(changelogPath, "utf-8");
  const header = "# Changelog\n\n";
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = existing
    .replace(/^# Changelog\s*\n*/, "")
    .replace(new RegExp(`^## ${escaped}\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, "m"), "");
  writeFileSync(changelogPath, header + entry + body);
} else {
  writeFileSync(changelogPath, `# Changelog\n\n${entry}`);
}

console.log(entry.trim());
