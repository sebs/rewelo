import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The website's Markdown renderer (site/markdown.mjs); build/test -> root
let render: (markdown: string, options?: { link?: (href: string) => string }) => string;

describe("site Markdown renderer", () => {
  before(async () => {
    ({ render } = await import(pathToFileURL(resolve(__dirname, "../../site/markdown.mjs")).href));
  });

  it("keeps a nested item's continuation text in that item only", () => {
    assert.equal(render("- a\n  - b\n  more text\n- c"), "<ul><li>a<ul><li>b more text</li></ul></li><li>c</li></ul>");
  });
});
