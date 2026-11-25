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

/** dashboard_version's _meta: only the app calls it, hidden from the model */
export const DASHBOARD_VERSION_META = { ui: { visibility: ["app"] } };

/** How often the page asks whether the dashboard changed, while it is visible */
export const REFRESH_POLL_MS = 5000;

// Runs in the host's iframe. A result is the dashboard as HTML, or, over
// 5 MB, a resource_link to read through the host. Only the dashboard's
// styles and body are shown, without any script: the page's own script is
// the only one that runs. The size goes to the host as it changes.
//
// The dashboard stays live: hosts pass no resource notifications to a page,
// so while it is visible the page asks dashboard_version (one cheap query)
// every few seconds, and calls report_dashboard again only when the version
// differs from the one in the dashboard's <meta name="rewelo-version">. The
// choices made on it (the flow's window, switches) are kept. A host that
// refuses the calls leaves it as it was.
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

  // The dashboard shown, while it refreshes: { project, limit, version, timer, busy, failures }
  let live;
  // A check may fail now and then (the rate limit): only so many in a row stop it
  const MAX_FAILURES = 3;

  const note = (text, state) => {
    let p = document.querySelector(".rewelo-live");
    if (!p) {
      p = document.createElement("p");
      p.className = "rewelo-live";
      p.setAttribute("role", "status");
      document.body.prepend(p);
    }
    p.dataset.state = state;
    p.textContent = text;
  };

  const stopLive = (reason) => {
    if (live) clearInterval(live.timer);
    live = undefined;
    if (reason) note("Not refreshing: " + reason, "stopped");
  };

  const meta = (doc, name) => {
    const tag = doc.querySelector('meta[name="' + name + '"]');
    return tag ? tag.content : undefined;
  };

  const goLive = (doc) => {
    stopLive();
    const project = meta(doc, "rewelo-project");
    const version = meta(doc, "rewelo-version");
    if (project === undefined || version === undefined) return;
    const limit = meta(doc, "rewelo-limit");
    live = { project, limit: limit === undefined ? undefined : Number(limit), version, busy: false, failures: 0 };
    live.timer = setInterval(poll, __POLL_MS__);
    note("Live: refreshes when the backlog changes", "live");
  };

  const textOf = (result) => ((result && result.content) || []).find((c) => c.type === "text");

  const poll = async () => {
    const current = live;
    if (!current || current.busy || document.hidden) return;
    current.busy = true;
    try {
      const answer = await request("tools/call", { name: "dashboard_version", arguments: { project: current.project } });
      if (answer.isError) throw new Error(textOf(answer) ? textOf(answer).text : "dashboard_version failed");
      const version = answer.structuredContent ? answer.structuredContent.version : JSON.parse(textOf(answer).text).version;
      current.failures = 0;
      if (live !== current || version === current.version) return;
      const args = { project: current.project };
      if (current.limit !== undefined) args.limit = current.limit;
      const fresh = await request("tools/call", { name: "report_dashboard", arguments: args });
      // A result the host sent meanwhile is newer
      if (live === current) await showResult(fresh);
    } catch (err) {
      if (live !== current) return;
      current.failures++;
      if (current.failures >= MAX_FAILURES) stopLive(err.message);
      return;
    } finally {
      current.busy = false;
    }
  };

  document.addEventListener("visibilitychange", () => void poll());

  // The choices made on the dashboard (the flow's window, switches, the
  // ticket browser's filter and page) and the dialogs open, in the order
  // they were opened, kept when it is replaced
  const choices = () => ({
    inputs: [...document.querySelectorAll("input[id]")]
      .filter((input) => input.type === "radio" || input.type === "checkbox")
      .map((input) => [input.id, input.checked]),
    dialogs: [...document.querySelectorAll("dialog[open]")].map((dialog) => dialog.id),
  });

  const show = (html, chosen) => {
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
    for (const [id, checked] of chosen ? chosen.inputs : []) {
      const input = document.getElementById(id);
      if (input) input.checked = checked;
    }
    for (const id of chosen ? chosen.dialogs : []) {
      const dialog = document.getElementById(id);
      if (dialog && dialog.showModal && !dialog.open) dialog.showModal();
    }
    goLive(doc);
  };

  const showResult = async (result) => {
    const chosen = choices();
    const content = (result && result.content) || [];
    const text = content.find((c) => c.type === "text");
    if (result.isError) {
      stopLive();
      return status(text ? text.text : "The dashboard could not be rendered.");
    }
    const link = content.find((c) => c.type === "resource_link");
    if (link) {
      // A refresh keeps the dashboard shown until the new one is there
      if (!live) status("Loading the dashboard …");
      const read = await request("resources/read", { uri: link.uri });
      const page = read.contents && read.contents.find((c) => typeof c.text === "string");
      return page ? show(page.text, chosen) : status("The dashboard resource was empty.");
    }
    if (text && /^<!doctype html>/i.test(text.text)) return show(text.text, chosen);
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
      stopLive();
      status("The dashboard was cancelled.");
    } else if (message.method === "ui/resource-teardown") {
      stopLive();
      send({ id: message.id, result: {} });
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
  .rewelo-live { margin: .5rem 1rem 0; font: 12px system-ui, sans-serif; color: var(--muted, GrayText); }
  .rewelo-live[data-state="live"]::before { content: "\\25CF  "; color: #56d7c6; }
  /* The frame is as tall as the dashboard (the host sizes it to the page): a
     dialog centred in it could open far from where it was asked for. Where
     anchors work, the ticket browser opens at its button and a ticket's
     details over the browser. */
  @supports (anchor-name: --a) {
    html .open-browser { anchor-name: --rewelo-browse; }
    html dialog.browser { anchor-name: --rewelo-browser; }
    html dialog.browser:modal { position-anchor: --rewelo-browse; top: anchor(top); bottom: auto; margin-top: 0; max-height: 44rem; }
    html dialog.ticket-detail:modal { position-anchor: --rewelo-browser; top: anchor(top); bottom: auto; margin-top: 2rem; max-height: 40rem; }
  }
</style>
</head>
<body>
<p class="status">Waiting for the dashboard …</p>
<script>${script
  .replace("__VERSION__", JSON.stringify(VERSION))
  .replace("__PROTOCOL__", JSON.stringify(PROTOCOL_VERSION))
  .replace("__POLL_MS__", String(REFRESH_POLL_MS))}</script>
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
