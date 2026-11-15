import { VERSION } from "../version.generated.js";
import type { McpContext } from "./toolkit.js";

// The dashboard as an MCP App (SEP-1865, specification 2026-01-26): a host
// that supports apps (Claude Desktop, claude.ai, VS Code, …) renders
// report_dashboard's result in this page, in a sandboxed iframe, instead of
// showing the HTML as text. Hosts without apps ignore the tool's _meta and
// get the HTML as text, as before.
//
// The page is one fixed resource; the project's dashboard comes in the tool
// result. It speaks the host protocol (JSON-RPC over postMessage) itself:
// the SDK's App class would add a bundle of half a megabyte for the few
// messages a page that only shows a result needs. Self-contained, as the
// host's default CSP allows inline scripts and styles but nothing loaded
// from elsewhere.

export const DASHBOARD_APP_URI = "ui://rewelo/dashboard.html";
export const APP_MIME_TYPE = "text/html;profile=mcp-app";
const PROTOCOL_VERSION = "2026-01-26";

/** report_dashboard's _meta: the current key, and the flat one older hosts read */
export const DASHBOARD_APP_META = { ui: { resourceUri: DASHBOARD_APP_URI }, "ui/resourceUri": DASHBOARD_APP_URI };

// Runs in the host's iframe. A result is the dashboard as HTML, or, over
// 5 MB, a resource_link to read through the host. Only the dashboard's
// styles and body are shown, without any script: the page's own script is
// the only one that runs. The size goes to the host as it changes.
const script = String.raw`
(() => {
  let nextId = 1;
  const pending = new Map();
  const send = (message) => window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
  const notify = (method, params) => send({ method, params });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  const status = (text) => {
    const p = document.createElement("p");
    p.className = "status";
    p.textContent = text;
    document.body.replaceChildren(p);
  };

  const theme = (context) => {
    if (context && (context.theme === "light" || context.theme === "dark")) document.documentElement.style.colorScheme = context.theme;
  };

  const show = (html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script").forEach((s) => s.remove());
    document.head.querySelectorAll("style[data-dashboard]").forEach((s) => s.remove());
    for (const style of doc.querySelectorAll("style")) {
      const copy = document.createElement("style");
      copy.dataset.dashboard = "";
      copy.textContent = style.textContent;
      document.head.append(copy);
    }
    if (doc.title) document.title = doc.title;
    document.body.replaceChildren(...[...doc.body.childNodes].map((node) => document.importNode(node, true)));
  };

  const showResult = async (result) => {
    const content = (result && result.content) || [];
    const text = content.find((c) => c.type === "text");
    if (result.isError) return status(text ? text.text : "The dashboard could not be rendered.");
    const link = content.find((c) => c.type === "resource_link");
    if (link) {
      status("Loading the dashboard …");
      const read = await request("resources/read", { uri: link.uri });
      const page = read.contents && read.contents.find((c) => typeof c.text === "string");
      return page ? show(page.text) : status("The dashboard resource was empty.");
    }
    if (text && /^<!doctype html>/i.test(text.text)) return show(text.text);
    status(text ? text.text : "No dashboard in the result.");
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
    if (message.method === "ui/notifications/tool-result") {
      showResult(message.params).catch((err) => status("The dashboard could not be loaded: " + err.message));
    } else if (message.method === "ui/notifications/host-context-changed") {
      theme(message.params);
    } else if (message.method === "ui/notifications/tool-cancelled") {
      status("The dashboard was cancelled.");
    } else if (message.id !== undefined && message.method !== undefined) {
      // A request this page doesn't serve
      send({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
    }
  });

  let last = "";
  new ResizeObserver(() => {
    const size = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
    if (JSON.stringify(size) === last) return;
    last = JSON.stringify(size);
    notify("ui/notifications/size-changed", size);
  }).observe(document.documentElement);

  request("ui/initialize", { appInfo: { name: "rewelo-dashboard", version: __VERSION__ }, appCapabilities: {}, protocolVersion: __PROTOCOL__ })
    .then((result) => {
      theme(result && result.hostContext);
      notify("ui/notifications/initialized", {});
    })
    .catch((err) => status("The host did not answer: " + err.message));
})();
`;

/** The app's page: a status line until the dashboard arrives */
export function dashboardAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rewelo dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .status { opacity: .7; }
</style>
</head>
<body>
<p class="status">Waiting for the dashboard …</p>
<script>${script.replace("__VERSION__", JSON.stringify(VERSION)).replace("__PROTOCOL__", JSON.stringify(PROTOCOL_VERSION))}</script>
</body>
</html>
`;
}

export function registerDashboardApp(ctx: McpContext): void {
  ctx.server.registerResource(
    "dashboard-app",
    DASHBOARD_APP_URI,
    {
      title: "Dashboard app",
      description: "The page in which hosts that support MCP Apps show report_dashboard's result",
      mimeType: APP_MIME_TYPE,
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: APP_MIME_TYPE, text: dashboardAppHtml() }] })
  );
}
