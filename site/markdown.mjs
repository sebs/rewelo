// A small Markdown renderer for the project's own docs: headings, fenced
// code, tables, nested lists, block quotes, rules and inline code, links,
// bold and italics. No dependencies; it only needs to cover what the docs use.

const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading anchor */
export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

function inline(text, link) {
  // Code spans first, so nothing inside them is formatted
  const codes = [];
  let s = escape(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${escape(link(href.replace(/&amp;/g, "&")))}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const indentOf = (line) => line.match(/^\s*/)[0].length;

function renderList(lines, link) {
  const base = indentOf(lines[0]);
  const ordered = /^\s*\d+\./.test(lines[0]);
  const start = ordered ? Number(lines[0].trim().match(/^\d+/)[0]) : 1;
  const items = [];
  for (const line of lines) {
    const m = line.match(LIST_ITEM);
    if (m && m[1].length === base) items.push([m[3]]);
    else items[items.length - 1].push(line);
  }
  const body = items
    .map(([first, ...rest]) => {
      const nested = rest.filter((l) => l.trim() !== "");
      const text = [first, ...nested.filter((l) => !LIST_ITEM.test(l)).map((l) => l.trim())].join(" ");
      const sub = nested.filter((l, i) => LIST_ITEM.test(l) || nested.slice(0, i).some((p) => LIST_ITEM.test(p)));
      return `<li>${inline(text, link)}${sub.length > 0 ? renderList(sub, link) : ""}</li>`;
    })
    .join("");
  return ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${body}</ol>` : `<ul>${body}</ul>`;
}

function renderTable(lines, link) {
  const cells = (line) =>
    line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, "|"), link));
  const [head, , ...rows] = lines;
  return (
    `<div class="table"><table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

/**
 * Render Markdown to HTML. `link` rewrites link targets (e.g. cli.md to the
 * site's page); headings get anchors, collected in `headings`.
 */
export function render(markdown, { link = (href) => href, headings = [] } = {}) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const used = new Map();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre${lang ? ` data-lang="${escape(lang)}"` : ""}><code>${escape(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.replace(/^#+\s*/, "");
      let id = slug(text);
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n > 0) id = `${id}-${n}`;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}"><a class="anchor" href="#${id}">${inline(text, link)}</a></h${level}>`);
      i++;
    } else if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const table = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) table.push(lines[i]);
      out.push(renderTable(table, link));
    } else if (/^>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      out.push(`<blockquote>${render(quote.join("\n"), { link })}</blockquote>`);
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
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
    } else {
      const para = [];
      for (
        ;
        i < lines.length && lines[i].trim() !== "" && !/^(```|#{1,6}\s|>|\s*\|)/.test(lines[i]) && !LIST_ITEM.test(lines[i]);
        i++
      ) {
        para.push(lines[i].trim());
      }
      out.push(`<p>${inline(para.join(" "), link)}</p>`);
    }
  }
  return out.join("\n");
}
