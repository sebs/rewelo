// A small Markdown renderer for the project's own docs. No dependencies.
//
// Covers the CommonMark/GFM subset the docs use or are likely to use:
// ATX and setext headings, ``` and ~~~ fences, indented code, tables (with
// or without outer pipes, with alignment), nested bullet (-, *, +) and
// ordered (1. or 1)) lists, block quotes, rules, and inline code spans (any
// number of backticks), links (with parentheses in the URL), images,
// autolinks, bold and italics with * and _, backslash escapes, entities and
// hard line breaks. Raw HTML is always escaped, never passed through.
// Not supported: reference-style links, footnotes, task lists, HTML blocks.

const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GitHub-style heading anchor: letters, marks, digits, connector punctuation
 * (e.g. "_", as in ticket_create) and hyphens are kept, spaces become hyphens
 */
export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

const emphasis = (s) =>
  s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*(?=[^*\s])([^*]*?[^*\s])?\*(?![*\w])/g, (m, pre, body) => (body === undefined ? m : `${pre}<em>${body}</em>`))
    .replace(/(^|[^*\w])\*([^*\s])\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>");

// A link or image target: no spaces, parentheses only in balanced pairs
const TARGET = "((?:[^()\\s]|\\((?:[^()\\s])*\\))+)";

function inline(text, link) {
  // Pieces that must not be touched by later steps become placeholders:
  // code spans, autolinks, escaped characters, line breaks, links, images
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;

  let s = text
    // Code spans, opened and closed by the same number of backticks
    .replace(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => {
      const body = /^ [\s\S]* $/.test(code) && code.trim() !== "" ? code.slice(1, -1) : code;
      return hold(`<code>${escape(body.replace(/\n/g, " "))}</code>`);
    })
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (_, url) => hold(`<a href="${escape(link(url))}">${escape(url)}</a>`))
    .replace(/\\\n/g, () => hold("<br>"))
    .replace(/\\([!-/:-@[-`{-~])/g, (_, ch) => hold(escape(ch)))
    .replace(/ {2,}\n/g, () => hold("<br>"))
    .replace(/\n/g, " ");

  // Raw HTML is escaped; entities such as &copy; stay entities
  s = escape(s).replace(/&amp;(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/gi, "&$1;");

  const target = (href) => escape(link(href.replace(/&amp;/g, "&")));
  s = s
    .replace(new RegExp(`!\\[([^\\]]*)\\]\\(${TARGET}\\)`, "g"), (_, alt, src) => hold(`<img src="${target(src)}" alt="${alt}">`))
    .replace(new RegExp(`\\[([^\\]]+)\\]\\(${TARGET}\\)`, "g"), (_, label, href) => hold(`<a href="${target(href)}">${emphasis(label)}</a>`));

  s = emphasis(s);
  // Placeholders may hold placeholders (code in a link's text)
  while (/\u0000\d+\u0000/.test(s)) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
  return s;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const indentOf = (line) => line.match(/^\s*/)[0].length;

// A table: a row with a pipe, then a separator row (| --- | :-: |). Without
// a leading pipe the separator must have one, so "a | b" over "---" stays a
// paragraph with a rule.
function tableStartsAt(lines, i) {
  const next = lines[i + 1] ?? "";
  return lines[i].includes("|") && TABLE_SEPARATOR.test(next) && (next.includes("|") || /^\s*\|/.test(lines[i]));
}

// Whether a list item may interrupt a paragraph: a bullet, or a number list
// starting at 1 (so "In\n2024. was fine" stays one paragraph)
function interruptsParagraph(line) {
  const m = line.match(LIST_ITEM);
  return Boolean(m) && m[3].trim() !== "" && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1);
}

function renderList(lines, link) {
  // Items sit at the smallest indent of the list, even if the first line is
  // indented deeper (it used to become the parent of everything after it)
  const base = Math.min(...lines.filter((l) => LIST_ITEM.test(l)).map(indentOf));
  const items = [];
  for (const line of lines) {
    const m = line.match(LIST_ITEM);
    if (m && (m[1].length === base || items.length === 0)) {
      // Where the item's text starts: continuation lines are indented to it
      const indent = line.length - m[3].length;
      items.push({ ordered: /\d/.test(m[2]), number: parseInt(m[2], 10), indent, lines: [m[3]] });
    } else {
      items[items.length - 1].lines.push(line);
    }
  }
  // A change between bullets and numbers starts a new list
  const lists = [];
  for (const item of items) {
    const current = lists[lists.length - 1];
    if (current && current[0].ordered === item.ordered) current.push(item);
    else lists.push([item]);
  }
  return lists.map((list) => renderItems(list, link)).join("");
}

function renderItems(items, link) {
  const ordered = items[0].ordered;
  const start = ordered ? items[0].number : 1;
  const body = items
    .map(({ indent, lines: [first, ...rest] }) => {
      // An item holding a code fence is rendered as blocks (text, fence, ...)
      if (rest.some((l) => FENCE.test(l.trim()))) {
        const dedent = new RegExp(`^ {0,${indent}}`);
        return `<li>${render([first, ...rest.map((l) => l.replace(dedent, ""))].join("\n"), { link })}</li>`;
      }
      // Lines before the first nested item continue this item's text; from
      // there on they belong to the nested list (and its items' text)
      const nested = rest.filter((l) => l.trim() !== "");
      const k = nested.findIndex((l) => LIST_ITEM.test(l));
      const text = [first, ...(k < 0 ? nested : nested.slice(0, k)).map((l) => l.trim())].join(" ");
      const sub = k < 0 ? [] : nested.slice(k);
      return `<li>${inline(text, link)}${sub.length > 0 ? renderList(sub, link) : ""}</li>`;
    })
    .join("");
  return ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${body}</ol>` : `<ul>${body}</ul>`;
}

function renderTable(lines, link) {
  // Split on pipes that are not escaped (\|); outer pipes are optional
  const split = (line) => line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const [head, separator, ...rows] = lines;
  const align = split(separator).map((c) =>
    /^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : /^:-+$/.test(c) ? "left" : ""
  );
  const cell = (tag, text, i) =>
    `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ""}>${inline(text.replace(/\\\|/g, "|"), link)}</${tag}>`;
  return (
    `<div class="table"><table><thead><tr>${split(head).map((c, i) => cell("th", c, i)).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${split(r).map((c, i) => cell("td", c, i)).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

/**
 * Render Markdown to HTML. `link` rewrites link targets (e.g. cli.md to the
 * site's page); headings get anchors, collected in `headings`.
 */
export function render(markdown, { link = (href) => href, headings = [], ids = new Set() } = {}) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out = [];

  const heading = (level, text) => {
    // Unique across the page (block quotes included): foo, foo-1, foo-2,
    // skipping ids a heading already has; "section" if nothing is left
    const base = slug(text) || "section";
    let id = base;
    for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    headings.push({ level, text, id });
    return `<h${level} id="${id}"><a class="anchor" href="#${id}">${inline(text, link)}</a></h${level}>`;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (FENCE.test(line)) {
      // ``` or ~~~, three or more; only a fence of the same kind and at least
      // the same length closes it
      const [, indent, fence, info] = line.match(FENCE);
      const lang = info.trim().split(/\s+/)[0];
      const closes = new RegExp(`^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      const code = [];
      for (i++; i < lines.length && !closes.test(lines[i]); i++) {
        code.push(lines[i].replace(new RegExp(`^ {0,${indent.length}}`), ""));
      }
      i++;
      out.push(`<pre${lang ? ` data-lang="${escape(lang)}"` : ""}><code>${escape(code.join("\n"))}</code></pre>`);
    } else if (/^ {4,}\S/.test(line)) {
      // Indented code block (it can't interrupt a paragraph or continue a
      // list: those lines are taken by the paragraph and list branches)
      const code = [];
      for (; i < lines.length && (/^ {4,}/.test(lines[i]) || (lines[i].trim() === "" && /^ {4,}\S/.test(lines[i + 1] ?? ""))); i++) {
        code.push(lines[i].replace(/^ {4}/, ""));
      }
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    } else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
      // "## Foo ##": closing hashes are not part of the text
      const level = line.trim().match(/^#+/)[0].length;
      const text = line.trim().replace(/^#+\s*/, "").replace(/(^|\s+)#+\s*$/, "");
      out.push(heading(level, text));
      i++;
    } else if (tableStartsAt(lines, i)) {
      const table = [];
      for (; i < lines.length && lines[i].trim() !== "" && lines[i].includes("|"); i++) table.push(lines[i]);
      out.push(renderTable(table, link));
    } else if (/^ {0,3}>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^ {0,3}>/.test(lines[i]); i++) quote.push(lines[i].replace(/^ {0,3}>\s?/, ""));
      out.push(`<blockquote>${render(quote.join("\n"), { link, headings, ids })}</blockquote>`);
    } else if (LIST_ITEM.test(line)) {
      const list = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (l.trim() === "") {
          // A blank line ends the list unless another item or an indented
          // continuation follows
          const next = lines[i + 1] ?? "";
          if (next.trim() !== "" && (LIST_ITEM.test(next) || indentOf(next) > 0)) continue;
          break;
        }
        if (!LIST_ITEM.test(l) && indentOf(l) === 0) break;
        list.push(l);
      }
      out.push(renderList(list, link));
    } else if (/^ {0,3}(-\s*){3,}$|^ {0,3}(\*\s*){3,}$|^ {0,3}(_\s*){3,}$/.test(line)) {
      out.push("<hr>");
      i++;
    } else {
      const para = [];
      let setext = 0;
      for (; i < lines.length && lines[i].trim() !== ""; i++) {
        const l = lines[i];
        // "Title" underlined with === or --- is a heading
        if (para.length > 0 && /^ {0,3}(=+|-+)\s*$/.test(l)) {
          setext = l.trim()[0] === "=" ? 1 : 2;
          i++;
          break;
        }
        if (
          para.length > 0 &&
          (/^ {0,3}(#{1,6}(\s|$)|>)/.test(l) || FENCE.test(l) || interruptsParagraph(l) || tableStartsAt(lines, i) ||
            /^ {0,3}(\*\s*){3,}$|^ {0,3}(_\s*){3,}$/.test(l))
        ) {
          break;
        }
        // Keep trailing spaces: two of them make a hard line break
        para.push(l.replace(/^\s+/, ""));
      }
      const text = para.join("\n").replace(/\s+$/, "");
      out.push(setext ? heading(setext, text.replace(/\n/g, " ")) : `<p>${inline(text, link)}</p>`);
    }
  }
  return out.join("\n");
}
