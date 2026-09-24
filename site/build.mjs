// Zero-dependency static site generator for the rewelo website.
//
//   node site/build.mjs            → builds the site into _site/
//   node site/build.mjs <outDir>   → builds into <outDir>/
//
// The docs pages are rendered from the repository's Markdown (Readme.md,
// cli.md, mcp.md, calculations.md, examples.md), so the site never drifts
// from them. Nothing here is committed: the Pages workflow assembles the site
// fresh and publishes it as an artifact.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./markdown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = resolve(process.argv[2] || join(root, "_site"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

const REPO = "https://github.com/sebs/rewelo";
// GitHub Pages serves the project under https://sebs.github.io/rewelo/, so
// root-absolute links need that prefix. SITE_BASE='' for a custom domain.
// Leading slash added and trailing one dropped: "rewelo" and "/rewelo/" both
// mean "/rewelo" (without the leading slash every asset link was relative).
const BASE = (process.env.SITE_BASE ?? "/rewelo").replace(/^\/*/, "/").replace(/\/+$/, "");
const withBase = (html) => (BASE ? html.replace(/(href|src)="\//g, `$1="${BASE}/`) : html);

const docs = [
  { file: "Readme.md", slug: "", label: "Overview", sub: "What rewelo is, how the method works, and how to run it." },
  { file: "cli.md", slug: "cli", label: "CLI", sub: "Every rw command and option." },
  { file: "mcp.md", slug: "mcp", label: "MCP server", sub: "Connect AI assistants and use the tools." },
  { file: "calculations.md", slug: "calculations", label: "Calculations", sub: "Priority, weighted priority and relative weights." },
  { file: "examples.md", slug: "examples", label: "Examples", sub: "Copy-paste prompts for Claude Code." },
];
const pageOf = new Map(docs.map((d) => [d.file.toLowerCase(), d.slug ? `/docs/${d.slug}/` : "/docs/"]));

// Links between the docs go to their pages; links to other repository files
// go to GitHub.
function link(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [path, anchor] = href.split("#");
  const page = pageOf.get(path.replace(/^\.\//, "").toLowerCase());
  if (page) return page + (anchor ? `#${anchor}` : "");
  return `${REPO}/blob/main/${path.replace(/^\.\//, "")}${anchor ? `#${anchor}` : ""}`;
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page({ title, description, active, main }) {
  const nav = [
    ["/", "Home", "home"],
    ["/docs/", "Docs", "docs"],
    ["/docs/cli/", "CLI", "cli"],
    ["/docs/mcp/", "MCP", "mcp"],
  ]
    .map(([href, label, key]) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
</head>
<body>
<header class="top">
  <a class="brand" href="/">rewelo</a>
  <nav>${nav}<a href="${REPO}">GitHub</a></nav>
</header>
${main}
<footer class="foot">
  <p>rewelo ${escape(pkg.version)} · ${escape(pkg.license)} licence · <a href="${REPO}">source on GitHub</a> · <a href="https://www.npmjs.com/package/rewelo">npm</a></p>
</footer>
</body>
</html>
`;
}

const write = (rel, html) => {
  const file = join(out, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, withBase(html));
};

// ── reset + static assets ──
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, "assets"), join(out, "assets"), { recursive: true });
// Serve files as they are, without Jekyll
writeFileSync(join(out, ".nojekyll"), "");

// ── landing ──
write(
  "index.html",
  page({
    title: "rewelo — relative weight prioritisation for backlogs",
    description: pkg.description,
    active: "home",
    main: readFileSync(join(here, "landing.html"), "utf-8").replace("{{version}}", escape(pkg.version)),
  })
);

// ── docs ──
for (const doc of docs) {
  const headings = [];
  const body = render(readFileSync(join(root, doc.file), "utf-8"), { link, headings });
  const sidebar = docs
    .map((d) => {
      const href = d.slug ? `/docs/${d.slug}/` : "/docs/";
      return `<a href="${href}"${d === doc ? ' aria-current="page"' : ""}>${d.label}</a>`;
    })
    .join("");
  const toc = headings
    .filter((h) => h.level === 2)
    .map((h) => `<a href="#${h.id}">${escape(h.text.replace(/`/g, ""))}</a>`)
    .join("");
  write(
    doc.slug ? `docs/${doc.slug}/index.html` : "docs/index.html",
    page({
      title: `${doc.label} — rewelo`,
      description: doc.sub,
      active: doc.slug === "cli" || doc.slug === "mcp" ? doc.slug : "docs",
      main: `<div class="docs">
<aside class="sidebar"><h4>Docs</h4>${sidebar}${toc ? `<h4>On this page</h4>${toc}` : ""}</aside>
<article class="prose">${body}
<p class="edit"><a href="${REPO}/blob/main/${doc.file}">Edit ${doc.file} on GitHub</a></p></article>
</div>`,
    })
  );
}

// ── 404 ──
write(
  "404.html",
  page({
    title: "Not found — rewelo",
    description: "This page does not exist.",
    active: "",
    main: `<main class="notfound"><h1>Not found</h1><p>This page does not exist. Try the <a href="/">home page</a> or the <a href="/docs/">docs</a>.</p></main>`,
  })
);

console.log(`Built the site into ${out}`);
