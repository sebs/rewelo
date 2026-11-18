import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// build/test -> repository root
const BUILD = resolve(__dirname, "../../site/build.mjs");

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : path.endsWith(".html") ? [path] : [];
  });
}

describe("website (site/build.mjs)", () => {
  let out: string;

  before(() => {
    out = mkdtempSync(join(tmpdir(), "rw-site-"));
    execFileSync(process.execPath, [BUILD, out], { stdio: "pipe", env: { ...process.env, SITE_BASE: "/rewelo" } });
  });

  after(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it("builds the landing page, a page per doc and the 404 page", () => {
    for (const page of ["index.html", "404.html", ".nojekyll", "docs/index.html", "docs/cli/index.html", "docs/mcp/index.html", "docs/calculations/index.html", "docs/examples/index.html", "docs/changelog/index.html"]) {
      assert.ok(existsSync(join(out, page)), page);
    }
  });

  it("has no broken links within the site, all under the Pages base path", () => {
    const broken: string[] = [];
    for (const file of htmlFiles(out)) {
      for (const [, href] of readFileSync(file, "utf-8").matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
        if (/^(https?:|mailto:|#)/.test(href)) continue;
        if (!href.startsWith("/rewelo/")) {
          broken.push(`${file}: ${href} (outside the base path)`);
          continue;
        }
        const path = href.slice("/rewelo/".length).split("#")[0];
        const target = join(out, path, path === "" || path.endsWith("/") ? "index.html" : "");
        if (!existsSync(target)) broken.push(`${file}: ${href}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it("renders links between docs as site pages and other files as GitHub links", () => {
    const overview = readFileSync(join(out, "docs/index.html"), "utf-8");
    assert.ok(overview.includes('href="/rewelo/docs/calculations/"'));
    const examples = readFileSync(join(out, "docs/examples/index.html"), "utf-8");
    assert.ok(examples.includes('href="https://github.com/sebs/rewelo/blob/main/fixtures/stories.csv"'));
  });

  it("shows the examples for MCP and for the CLI, linked from the navigation", () => {
    const examples = readFileSync(join(out, "docs/examples/index.html"), "utf-8");
    assert.ok(examples.includes("mcp tool: import_csv"));
    assert.ok(examples.includes("$ rw import csv backlog.csv --project prio-tool"));
    assert.ok(examples.includes('<a href="/rewelo/docs/examples/" aria-current="page">Examples</a>'));
    assert.ok(readFileSync(join(out, "index.html"), "utf-8").includes('href="/rewelo/docs/examples/"'));
  });

  it("lists a page's subsections under its sections, so the CLI page names its commands", () => {
    const cli = readFileSync(join(out, "docs/cli/index.html"), "utf-8");
    const toc = cli.slice(cli.indexOf("On this page"), cli.indexOf("</aside>"));
    assert.match(toc, /<a href="#commands">Commands<\/a>/);
    assert.match(toc, /<a href="#report" class="sub">report<\/a>/);
  });

  it("shows the current features and both ways to run the MCP server on the landing page", () => {
    const home = readFileSync(join(out, "index.html"), "utf-8");
    for (const text of ["MCP server from npm", "claude mcp add rewelo -- rw serve", "MCP server in Docker", "Flow and forecasts", "A live dashboard", "Checks on the scoring"]) {
      assert.ok(home.includes(text), text);
    }
    assert.match(home, /href="\/rewelo\/docs\/mcp\/#without-docker"/);
  });

  it("has a changelog page made from the releases, linked from the landing page", () => {
    const page = readFileSync(join(out, "docs/changelog/index.html"), "utf-8");
    // A clone with the tags lists the releases; a shallow one (CI) links to them
    const tags = execFileSync("git", ["tag", "--list", "v*"], { cwd: resolve(__dirname, "../.."), stdio: "pipe" }).toString().trim();
    if (tags) {
      assert.match(page, /<h2 id="0100"><a class="anchor" href="#0100">0\.10\.0<\/a><\/h2>/);
      assert.match(page, /forecast when tickets will be done/);
      const toc = page.slice(page.indexOf("On this page"), page.indexOf("</aside>"));
      assert.doesNotMatch(toc, /class="sub"/);
    } else {
      assert.match(page, /The release notes are on <a href="https:\/\/github\.com\/sebs\/rewelo\/releases">GitHub<\/a>/);
    }
    assert.match(readFileSync(join(out, "index.html"), "utf-8"), /<a href="\/rewelo\/docs\/changelog\/">what&#39;s new<\/a>|<a href="\/rewelo\/docs\/changelog\/">what's new<\/a>/);
  });

  it("gives every page a link preview with absolute URLs", () => {
    const cli = readFileSync(join(out, "docs/cli/index.html"), "utf-8");
    assert.match(cli, /<link rel="canonical" href="https:\/\/sebs\.maschinenlesbar\.org\/rewelo\/docs\/cli\/">/);
    assert.match(cli, /<meta property="og:title" content="CLI — rewelo">/);
    assert.match(cli, /<meta property="og:image" content="https:\/\/sebs\.maschinenlesbar\.org\/rewelo\/assets\/dashboard-light\.png">/);
    assert.match(cli, /<meta name="twitter:card" content="summary_large_image">/);
    const home = readFileSync(join(out, "index.html"), "utf-8");
    assert.match(home, /<meta property="og:url" content="https:\/\/sebs\.maschinenlesbar\.org\/rewelo\/">/);
    assert.ok(existsSync(join(out, "assets/dashboard-light.png")));
  });

  it("lists every page in a sitemap for search engines, by absolute URL", () => {
    const sitemap = readFileSync(join(out, "sitemap.xml"), "utf-8");
    assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
    const site = "https://sebs.maschinenlesbar.org/rewelo/";
    assert.deepEqual(urls, ["", "docs/", "docs/cli/", "docs/mcp/", "docs/calculations/", "docs/examples/", "docs/changelog/"].map((path) => site + path));
  });

  it("shows the dashboard, in the reader's light or dark", () => {
    const home = readFileSync(join(out, "index.html"), "utf-8");
    assert.match(home, /<source srcset="\/rewelo\/assets\/dashboard-dark\.png" media="\(prefers-color-scheme: dark\)">/);
    assert.match(home, /<img src="\/rewelo\/assets\/dashboard-light\.png" width="1200" height="876" alt="The dashboard of a demo project/);
  });

  it("shows what the CLI example prints", () => {
    const home = readFileSync(join(out, "index.html"), "utf-8");
    assert.match(home, /What you get<\/h3>\s*<pre class="output"><code>Title +\| B/);
    assert.match(home, /Password reset \| 5 \| +8 \| 2 \| 1 \| +13 \| +3 \| +4\.33/);
  });

  it("lets a keyboard user skip the navigation to the page's one main landmark", () => {
    for (const page of ["index.html", "docs/index.html", "docs/cli/index.html", "404.html"]) {
      const html = readFileSync(join(out, page), "utf-8");
      assert.match(html, /<body>\n<a class="skip" href="#content">Skip to content<\/a>/, page);
      assert.equal(html.match(/<main\b/g)?.length, 1, page);
      assert.match(html, /<main id="content">/, page);
    }
  });

  it("puts the contents into a closed <details> for narrow screens", () => {
    const mcp = readFileSync(join(out, "docs/mcp/index.html"), "utf-8");
    assert.match(mcp, /<details class="contents"><summary>Contents<\/summary><nav aria-label="Docs">/);
    assert.doesNotMatch(mcp, /<details class="contents" open/);
  });

  it("names links to a doc by its page, not its file name", () => {
    const overview = readFileSync(join(out, "docs/index.html"), "utf-8");
    assert.match(overview, /<a href="\/rewelo\/docs\/calculations\/">Calculations<\/a>/);
    assert.doesNotMatch(overview, />calculations\.md</);
    assert.doesNotMatch(overview, / -- /);
  });

  it("leaves out what the docs mark as for GitHub only, and the maintainers' release steps", () => {
    const overview = readFileSync(join(out, "docs/index.html"), "utf-8");
    assert.doesNotMatch(overview, /Website and docs|site:omit/);
    assert.doesNotMatch(overview, /Releasing a New Version/);
    assert.match(overview, /<h2 id="docker">/);
  });

  it("adds the leading slash SITE_BASE is missing", () => {
    const other = mkdtempSync(join(tmpdir(), "rw-site-"));
    try {
      execFileSync(process.execPath, [BUILD, other], { stdio: "pipe", env: { ...process.env, SITE_BASE: "rewelo/" } });
      assert.ok(readFileSync(join(other, "docs/cli/index.html"), "utf-8").includes('href="/rewelo/assets/style.css"'));
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
