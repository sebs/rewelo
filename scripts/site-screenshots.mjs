#!/usr/bin/env node
/**
 * Screenshots of the dashboard for the website, in light and dark:
 * site/assets/dashboard-light.png and site/assets/dashboard-dark.png.
 *
 *   npm run build && node scripts/site-screenshots.mjs
 *
 * Fills an in-memory demo project with ten weeks of made-up but plausible
 * history (seeded, so every run draws the same), renders its dashboard with
 * the built rewelo (dist/), and photographs the top of it (health, the
 * cumulative flow and the forecast) with headless Chrome. CHROME names the
 * browser when it isn't Google Chrome in its usual macOS place.
 *
 * The site build doesn't run this: it needs a browser. Run it again when the
 * dashboard's look changes, and commit the images.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (path) => import(pathToFileURL(join(root, "dist", path)).href);
const { DB } = await dist("db/connection.js");
const { migrate } = await dist("db/migrate.js");
const { createProject } = await dist("projects/repository.js");
const { createTicket } = await dist("tickets/repository.js");
const { createTag } = await dist("tags/repository.js");
const { assignTag } = await dist("tags/assignment.js");
const { createRelation } = await dist("relations/repository.js");
const { renderDashboard } = await dist("reports/dashboard.js");

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NOW = new Date("2026-11-16T12:00:00Z");
const DAY = 86_400_000;
const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];
const TITLES = [
  "Login page", "Password reset", "Audit log", "Dark mode", "Export to CSV", "SSO with SAML", "Rate limiting", "Search filters",
  "Invoice PDFs", "Webhooks", "Two-factor login", "Usage dashboard", "Bulk edit", "Email digests", "API keys", "Team roles",
];

// The same "random" history every run (Park–Miller)
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const score = () => FIBONACCI[Math.floor(random() * FIBONACCI.length)];
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

const db = await DB.open(":memory:");
await migrate(db);
const { id: projectId } = await createProject(db, "Checkout revamp");
const wip = await createTag(db, projectId, "state", "wip");
const done = await createTag(db, projectId, "state", "done");

// About one ticket a day for ten weeks; most get started a few days later
// and done a few days after that
const ids = [];
for (let i = 0; i < 70; i++) {
  const title = `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` (${Math.floor(i / TITLES.length) + 1})` : ""}`;
  const ticket = await createTicket(db, { projectId, title, benefit: score(), penalty: score(), estimate: score(), risk: score() });
  ids.push(ticket.id);
  const created = Math.floor(75 - i * 1.05 - random() * 3);
  await db.run("UPDATE tickets SET created_at = ? WHERE id = ?", ago(created), ticket.id);
  const started = created - Math.floor(4 + random() * 12);
  if (started <= 0) continue;
  await assignTag(db, ticket.id, wip.id);
  await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ? AND value = 'wip'", ago(started), ticket.id);
  const finished = started - Math.floor(2 + random() * 9);
  if (finished <= 0) continue;
  await assignTag(db, ticket.id, done.id);
  await db.run("UPDATE ticket_tag_changes SET changed_at = ? WHERE ticket_id = ? AND value = 'done'", ago(finished), ticket.id);
}
for (const [source, target, type] of [[63, 68, "blocks"], [68, 66, "blocks"], [56, 66, "blocks"], [69, 57, "depends-on"], [63, 64, "blocks"]]) {
  await createRelation(db, projectId, ids[source], ids[target], type);
}

const html = await renderDashboard(db, projectId, "Checkout revamp", { generatedAt: NOW.toISOString() });
await db.close();

const work = mkdtempSync(join(tmpdir(), "rewelo-shots-"));
try {
  const page = join(work, "dashboard.html");
  writeFileSync(page, html);
  for (const [theme, scheme] of [["light", 1], ["dark", 0]]) {
    const out = join(root, "site", "assets", `dashboard-${theme}.png`);
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1200,876",
      `--blink-settings=preferredColorScheme=${scheme}`, `--user-data-dir=${join(work, "profile")}`,
      `--screenshot=${out}`, pathToFileURL(page).href,
    ], { stdio: "ignore" });
    console.log(`Wrote ${out}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
