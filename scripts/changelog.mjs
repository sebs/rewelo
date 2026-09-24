#!/usr/bin/env node
/**
 * Generate a changelog entry from git log between the previous tag and HEAD (or a given tag).
 *
 * Usage:
 *   node scripts/changelog.mjs              # latest tag → HEAD, as "Unreleased"
 *   node scripts/changelog.mjs v0.3.5       # previous tag → v0.3.5
 *
 * Commits are grouped by conventional-commit prefix (feat, fix, etc.).
 * Commits without a recognised prefix go under "Other".
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const tags = execSync("git tag --sort=-version:refname").toString().trim().split("\n").filter(Boolean);

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
  const currentIdx = tags.indexOf(vTag);
  if (currentIdx < 0) {
    console.error(`Unknown tag "${tag}". Known tags: ${tags.slice(0, 5).join(", ")}${tags.length > 5 ? ", ..." : ""}`);
    process.exit(1);
  }
  const previousTag = currentIdx >= 0 && currentIdx < tags.length - 1 ? tags[currentIdx + 1] : "";
  range = previousTag ? `${previousTag}..${vTag}` : vTag;
}
const log = execSync(`git log ${range} --pretty=format:"%s" --no-merges`).toString().trim();

if (!log) {
  console.error("No commits found.");
  process.exit(1);
}

const groups = { breaking: [], feat: [], fix: [], perf: [], refactor: [], docs: [], test: [], chore: [], other: [] };
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

for (const line of log.split("\n")) {
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

let entry = `## ${version}\n\n`;
for (const [key, items] of Object.entries(groups)) {
  if (items.length === 0) continue;
  if (Object.values(groups).filter((g) => g.length > 0).length > 1) {
    entry += `### ${labels[key]}\n\n`;
  }
  for (const item of items) {
    entry += `- ${item}\n`;
  }
  entry += "\n";
}

// Add to CHANGELOG.md, replacing an entry for the same version (running the
// script twice used to add a second one)
const changelogPath = "CHANGELOG.md";
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
