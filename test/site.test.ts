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
    for (const page of ["index.html", "404.html", ".nojekyll", "docs/index.html", "docs/cli/index.html", "docs/mcp/index.html", "docs/calculations/index.html", "docs/examples/index.html"]) {
      assert.ok(existsSync(join(out, page)), page);
    }
  });

  it("has no broken links within the site, all under the Pages base path", () => {
    const broken: string[] = [];
    for (const file of htmlFiles(out)) {
      for (const [, href] of readFileSync(file, "utf-8").matchAll(/(?:href|src)="([^"]+)"/g)) {
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
});
