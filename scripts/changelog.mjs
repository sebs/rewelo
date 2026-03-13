#!/usr/bin/env node
/**
 * Generate a changelog entry from git log between the previous tag and HEAD (or a given tag).
 *
 * Usage:
 *   node scripts/changelog.mjs              # previous tag → HEAD
 *   node scripts/changelog.mjs v0.3.5       # previous tag → v0.3.5
 *
 * Commits are grouped by conventional-commit prefix (feat, fix, etc.).
 * Commits without a recognised prefix go under "Other".
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";

const tag = process.argv[2] ?? execSync("git describe --tags --abbrev=0").toString().trim();
const version = tag.replace(/^v/, "");
const vTag = tag.startsWith("v") ? tag : `v${tag}`;

// Find the previous tag
const tags = execSync("git tag --sort=-version:refname").toString().trim().split("\n").filter(Boolean);
const currentIdx = tags.indexOf(vTag);
const previousTag = currentIdx >= 0 && currentIdx < tags.length - 1 ? tags[currentIdx + 1] : "";

const range = previousTag ? `${previousTag}..${vTag}` : vTag;
const log = execSync(`git log ${range} --pretty=format:"%s" --no-merges`).toString().trim();

if (!log) {
  console.error("No commits found.");
  process.exit(1);
}

const groups = { feat: [], fix: [], refactor: [], docs: [], chore: [], other: [] };
const labels = { feat: "Features", fix: "Fixes", refactor: "Refactoring", docs: "Documentation", chore: "Chores", other: "Other" };

for (const line of log.split("\n")) {
  const match = line.match(/^(\w+)(?:\(.+?\))?:\s*(.+)/);
  if (match && groups[match[1]]) {
    groups[match[1]].push(match[2].trim());
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

// Prepend to CHANGELOG.md
const changelogPath = "CHANGELOG.md";
if (existsSync(changelogPath)) {
  const existing = readFileSync(changelogPath, "utf-8");
  const header = "# Changelog\n\n";
  const body = existing.replace(/^# Changelog\s*\n*/, "");
  writeFileSync(changelogPath, header + entry + body);
} else {
  writeFileSync(changelogPath, `# Changelog\n\n${entry}`);
}

console.log(entry.trim());
