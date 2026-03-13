#!/usr/bin/env node

/**
 * Static site builder.
 *
 * Reads markdown files from site/content/, renders them to HTML with
 * the template, and writes them to site/public/. CSS and JS are copied
 * as-is (no bundler — the JS uses native ES modules).
 *
 * Usage:  node site/build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(__dirname, "content");
const SRC = join(__dirname, "src");
const OUT = join(__dirname, "public");

// --- Minimal markdown → HTML renderer ---
// Handles the subset we actually use: headings, paragraphs, tables,
// code blocks, blockquotes, lists, horizontal rules, inline formatting.

function parseMarkdown(md) {
  // Strip frontmatter
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  let body = md;
  if (fmMatch) {
    body = md.slice(fmMatch[0].length);
    fmMatch[1].split("\n").forEach((line) => {
      const [k, ...v] = line.split(":");
      if (k) meta[k.trim()] = v.join(":").trim();
    });
  }

  const html = renderBlocks(body);
  return { meta, html };
}

function renderBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === "") { i++; continue; }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = inline(hMatch[2]);
      const id = hMatch[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      out.push(`<h${level} id="${id}" class="fade-in">${text}</h${level}>`);
      i++;
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      const langAttr = lang ? ` class="language-${lang}"` : "";
      out.push(`<pre class="fade-in"><code${langAttr}>${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const bqLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        bqLines.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote class="fade-in"><p>${inline(bqLines.join(" "))}</p></blockquote>`);
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      out.push(renderTable(tableLines));
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^[-*]\s+/, "")));
        i++;
      }
      out.push(`<ul class="fade-in">${items.map((li) => `<li>${li}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\d+\.\s+/, "")));
        i++;
      }
      out.push(`<ol class="fade-in">${items.map((li) => `<li>${li}</li>`).join("")}</ol>`);
      continue;
    }

    // Paragraph
    const pLines = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].startsWith("> ") && !lines[i].startsWith("---") && !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i + 1]))) {
      pLines.push(lines[i]);
      i++;
    }
    if (pLines.length) {
      out.push(`<p class="fade-in">${inline(pLines.join(" "))}</p>`);
    }
  }

  return out.join("\n");
}

function renderTable(lines) {
  const parse = (l) =>
    l.split("|").map((c) => c.trim()).filter((c) => c !== "");

  const headers = parse(lines[0]);
  // lines[1] is the separator
  const rows = lines.slice(2).map(parse);

  let html = `<table class="fade-in"><thead><tr>`;
  headers.forEach((h) => { html += `<th>${inline(h)}</th>`; });
  html += `</tr></thead><tbody>`;
  rows.forEach((row) => {
    html += `<tr>`;
    row.forEach((cell) => { html += `<td>${inline(cell)}</td>`; });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text) {
  return text
    // inline code (before other formatting)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    // bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // em dash
    .replace(/ -- /g, " &mdash; ");
}

// --- HTML template ---
function template(meta, content) {
  const title = meta.title || "Rewelo";
  const desc = meta.description || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <canvas id="gl-canvas"></canvas>
  <div class="content">
    ${content}
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>`;
}

// --- Build ---
mkdirSync(OUT, { recursive: true });

// Copy static assets
cpSync(join(SRC, "style.css"), join(OUT, "style.css"));
cpSync(join(SRC, "main.js"),  join(OUT, "main.js"));
cpSync(join(SRC, "gl.js"),    join(OUT, "gl.js"));

// Render markdown
const md = readFileSync(join(CONTENT, "index.md"), "utf-8");
const { meta, html } = parseMarkdown(md);
const page = template(meta, html);
writeFileSync(join(OUT, "index.html"), page);

console.log("Built site/public/index.html");
