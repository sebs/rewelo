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

  it("nests by indent even when the first item is indented, and splits bullets from numbers", () => {
    assert.equal(render("   - a\n- b"), "<ul><li>a</li><li>b</li></ul>");
    assert.equal(render("- a\n1. b"), "<ul><li>a</li></ul><ol><li>b</li></ol>");
    assert.equal(render("3. c\n4. d"), '<ol start="3"><li>c</li><li>d</li></ol>');
  });

  it("leaves link targets alone while formatting link text", () => {
    assert.equal(render("[**a**](https://x.com/**b**)"), '<p><a href="https://x.com/**b**"><strong>a</strong></a></p>');
    assert.equal(render("see `**x**` and *y*"), "<p>see <code>**x**</code> and <em>y</em></p>");
  });

  it("gives every heading a unique, non-empty id", () => {
    const ids = (md: string) => [...render(md).matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(ids("## Foo\n## Foo\n## Foo-1"), ["foo", "foo-1", "foo-1-1"]);
    assert.deepEqual(ids("> ## Foo\n\n## Foo"), ["foo", "foo-1"]);
    assert.deepEqual(ids("## ???\n## ???"), ["section", "section-1"]);
  });

  it("builds heading ids the way GitHub does", () => {
    assert.match(render("## ticket_create"), / id="ticket_create"/);
    assert.match(render("## Foo ##"), /<h2 id="foo"><a class="anchor" href="#foo">Foo<\/a><\/h2>/);
    assert.match(render("## Café & Co."), / id="café--co"/);
  });

  it("renders ~~~ fences, longer fences and fences inside list items", () => {
    assert.equal(render("~~~\n# not a heading\n~~~"), "<pre><code># not a heading</code></pre>");
    assert.equal(render("````md\n```\ninner\n```\n````"), '<pre data-lang="md"><code>```\ninner\n```</code></pre>');
    assert.equal(
      render("1. step\n   ```bash\n   rw x\n   ```\n2. next"),
      '<ol><li><p>step</p>\n<pre data-lang="bash"><code>rw x</code></pre></li><li>next</li></ol>'
    );
  });

  it("renders the CommonMark/GFM constructs it used to get wrong", () => {
    const cases: [string, string][] = [
      ["[wiki](https://en.wikipedia.org/wiki/Foo_(bar))", '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a></p>'],
      ["![logo](img.png)", '<p><img src="img.png" alt="logo"></p>'],
      ["<https://x.org>", '<p><a href="https://x.org">https://x.org</a></p>'],
      ["``a`b``", "<p><code>a`b</code></p>"],
      ["\\*x\\*", "<p>*x*</p>"],
      ["&copy; &amp; <b>", "<p>&copy; &amp; &lt;b&gt;</p>"],
      ["**a * b**", "<p><strong>a * b</strong></p>"],
      ["_em_ and __strong__ but snake_case_name", "<p><em>em</em> and <strong>strong</strong> but snake_case_name</p>"],
      ["Title\n=====", '<h1 id="title"><a class="anchor" href="#title">Title</a></h1>'],
      ["Sub\n---", '<h2 id="sub"><a class="anchor" href="#sub">Sub</a></h2>'],
      ["+ a\n+ b", "<ul><li>a</li><li>b</li></ul>"],
      ["1) a\n2) b", "<ol><li>a</li><li>b</li></ol>"],
      ["    code line\n    more", "<pre><code>code line\nmore</code></pre>"],
      ["a | b\n--- | ---\n1 | 2", '<div class="table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'],
      ["| l | c | r |\n|:--|:-:|--:|\n| 1 | 2 | 3 |", '<div class="table"><table><thead><tr><th style="text-align:left">l</th><th style="text-align:center">c</th><th style="text-align:right">r</th></tr></thead><tbody><tr><td style="text-align:left">1</td><td style="text-align:center">2</td><td style="text-align:right">3</td></tr></tbody></table></div>'],
      ["line one  \nline two", "<p>line one<br>line two</p>"],
      ["In\n2024. was fine", "<p>In 2024. was fine</p>"],
    ];
    for (const [markdown, html] of cases) assert.equal(render(markdown), html, markdown);
  });
});
