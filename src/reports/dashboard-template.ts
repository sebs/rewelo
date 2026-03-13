import { DashboardData } from "./dashboard.js";

export function renderDashboardHtml(data: DashboardData): string {
  // Escape < and > in JSON to prevent script injection when embedded in <script>
  const d = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(data.projectName)} — Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0f1117;--surface:#1a1d27;--border:#2a2d3a;--text:#e1e4ed;--muted:#8b8fa3;
--accent:#6366f1;--accent2:#818cf8;--green:#22c55e;--yellow:#eab308;--red:#ef4444;
--orange:#f97316;--cyan:#06b6d4;--radius:8px;--shadow:0 2px 8px rgba(0,0,0,.3)}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:var(--bg);color:var(--text);line-height:1.6;padding:2rem}
.container{max-width:1280px;margin:0 auto}
header{margin-bottom:2rem;border-bottom:1px solid var(--border);padding-bottom:1rem}
header h1{font-size:1.75rem;font-weight:700}
header .meta{color:var(--muted);font-size:.85rem;margin-top:.25rem}
.grid{display:grid;gap:1.5rem;margin-bottom:1.5rem}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(400px,1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
padding:1.25rem;box-shadow:var(--shadow)}
.card h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:var(--muted);
text-transform:uppercase;letter-spacing:.05em;font-size:.8rem}
.metric{font-size:2rem;font-weight:700;line-height:1.2}
.metric-label{font-size:.8rem;color:var(--muted);margin-top:.25rem}
.metric.green{color:var(--green)}.metric.yellow{color:var(--yellow)}
.metric.red{color:var(--red)}.metric.accent{color:var(--accent2)}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{text-align:left;padding:.6rem .75rem;border-bottom:2px solid var(--border);
color:var(--muted);font-weight:600;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:var(--accent2)}
th .sort-arrow{margin-left:.25rem;font-size:.7rem}
td{padding:.5rem .75rem;border-bottom:1px solid var(--border)}
tr:hover td{background:rgba(99,102,241,.06)}
.state-badge{display:inline-block;padding:.15rem .5rem;border-radius:10px;
font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.state-done{background:rgba(34,197,94,.15);color:var(--green)}
.state-wip{background:rgba(234,179,8,.15);color:var(--yellow)}
.state-backlog{background:rgba(139,143,163,.15);color:var(--muted)}
.state-default{background:rgba(99,102,241,.15);color:var(--accent2)}
.dist-section{margin-bottom:1.5rem}
.dist-section h3{font-size:.85rem;font-weight:600;text-transform:capitalize;margin-bottom:.5rem}
.bar-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem}
.bar-label{width:2rem;text-align:right;font-size:.8rem;color:var(--muted);font-variant-numeric:tabular-nums}
.bar-track{flex:1;height:20px;background:var(--bg);border-radius:3px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;transition:width .3s;min-width:1px}
.bar-fill.benefit{background:var(--green)}.bar-fill.penalty{background:var(--red)}
.bar-fill.estimate{background:var(--cyan)}.bar-fill.risk{background:var(--orange)}
.bar-count{width:2rem;font-size:.8rem;color:var(--muted);font-variant-numeric:tabular-nums}
#graph-container{width:100%;height:500px;position:relative;overflow:hidden;background:var(--bg);border-radius:var(--radius)}
#graph-svg{width:100%;height:100%}
.graph-controls{display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap}
.graph-controls button{background:var(--surface);border:1px solid var(--border);color:var(--text);
padding:.35rem .75rem;border-radius:var(--radius);cursor:pointer;font-size:.8rem}
.graph-controls button:hover{border-color:var(--accent)}
.graph-controls button.active{background:var(--accent);border-color:var(--accent)}
.node-tooltip{position:absolute;background:var(--surface);border:1px solid var(--border);
border-radius:var(--radius);padding:.75rem;font-size:.8rem;pointer-events:none;
box-shadow:var(--shadow);max-width:280px;z-index:10;display:none}
.node-tooltip h4{font-weight:600;margin-bottom:.35rem}
.node-tooltip .scores{display:grid;grid-template-columns:1fr 1fr;gap:.15rem .75rem}
.empty{color:var(--muted);font-style:italic;text-align:center;padding:2rem}
.tag{display:inline-block;padding:.1rem .4rem;border-radius:4px;font-size:.7rem;
background:rgba(99,102,241,.15);color:var(--accent2);margin:.1rem}
footer{margin-top:2rem;text-align:center;color:var(--muted);font-size:.8rem;
border-top:1px solid var(--border);padding-top:1rem}
</style>
</head>
<body>
<div class="container">
<header>
<h1>${esc(data.projectName)}</h1>
<div class="meta">Generated ${new Date(data.generatedAt).toLocaleString()} · Relative Weight CLI</div>
</header>

<!-- Health Indicators -->
<div class="grid grid-4">
<div class="card">
<h2>Total Tickets</h2>
<div class="metric accent">${data.summary.totalTickets}</div>
<div class="metric-label">${data.health.openTickets} open · ${data.health.doneTickets} done</div>
</div>
<div class="card">
<h2>High Priority</h2>
<div class="metric ${data.health.highPriorityCount > 0 ? "green" : "muted"}">${data.health.highPriorityCount}</div>
<div class="metric-label">above threshold (1.5)</div>
</div>
<div class="card">
<h2>High:Low Ratio</h2>
<div class="metric ${ratioColor(data.health.highToLowRatio)}">${data.health.highToLowRatio ?? "—"}</div>
<div class="metric-label">${data.health.lowPriorityCount} low priority</div>
</div>
<div class="card">
<h2>Backlog Cost</h2>
<div class="metric yellow">${data.health.totalBacklogCost}</div>
<div class="metric-label">sum of estimate + risk (open)</div>
</div>
</div>

<!-- State Breakdown -->
<div class="grid grid-2">
<div class="card">
<h2>By State</h2>
${stateBreakdown(data)}
</div>
<div class="card">
<h2>Top by Priority</h2>
${topPriority(data)}
</div>
</div>

<!-- Score Distribution -->
<div class="card" style="margin-bottom:1.5rem">
<h2>Score Distribution</h2>
${distributionBars(data)}
</div>

<!-- Priority Table -->
<div class="card" style="margin-bottom:1.5rem">
<h2>All Tickets</h2>
${data.tickets.length === 0 ? '<div class="empty">No tickets in this project.</div>' : `
<table id="ticket-table">
<thead><tr>
<th data-col="title">Title <span class="sort-arrow"></span></th>
<th data-col="state">State <span class="sort-arrow"></span></th>
<th data-col="benefit" data-type="num">B <span class="sort-arrow"></span></th>
<th data-col="penalty" data-type="num">P <span class="sort-arrow"></span></th>
<th data-col="estimate" data-type="num">E <span class="sort-arrow"></span></th>
<th data-col="risk" data-type="num">R <span class="sort-arrow"></span></th>
<th data-col="value" data-type="num">Value <span class="sort-arrow"></span></th>
<th data-col="cost" data-type="num">Cost <span class="sort-arrow"></span></th>
<th data-col="priority" data-type="num">Priority <span class="sort-arrow"></span></th>
</tr></thead>
<tbody>
${data.tickets
  .sort((a, b) => b.priority - a.priority)
  .map((t) => `<tr>
<td>${esc(t.title)}</td>
<td><span class="state-badge state-${stateClass(t.state)}">${esc(t.state)}</span></td>
<td>${t.benefit}</td><td>${t.penalty}</td><td>${t.estimate}</td><td>${t.risk}</td>
<td>${t.value}</td><td>${t.cost}</td><td>${t.priority.toFixed(2)}</td>
</tr>`).join("\n")}
</tbody>
</table>`}
</div>

<!-- Dependency Graph -->
<div class="card">
<h2>Dependency Graph</h2>
${data.relations.length === 0
  ? '<div class="empty">No relations defined between tickets.</div>'
  : `<div class="graph-controls">
<button class="active" data-filter="all">All</button>
${uniqueTypes(data).map((t) => `<button data-filter="${esc(t)}">${esc(t)}</button>`).join("")}
</div>
<div id="graph-container">
<svg id="graph-svg"></svg>
<div class="node-tooltip" id="tooltip"></div>
</div>`}
</div>

<footer>Relative Weight CLI · ${esc(data.projectName)}</footer>
</div>

<script>
const DATA = ${d};

// === Table sorting ===
(function(){
  const table = document.getElementById('ticket-table');
  if (!table) return;
  const headers = table.querySelectorAll('th');
  let sortCol = 'priority', sortAsc = false;

  headers.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = col === 'title' || col === 'state'; }
      sortTable();
    });
  });

  function sortTable() {
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = Array.from(headers).findIndex(h => h.dataset.col === sortCol);
    const isNum = headers[idx]?.dataset.type === 'num';

    rows.sort((a, b) => {
      let va = a.children[idx].textContent.trim();
      let vb = b.children[idx].textContent.trim();
      if (isNum) { va = parseFloat(va); vb = parseFloat(vb); }
      else { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    rows.forEach(r => tbody.appendChild(r));
    headers.forEach(h => {
      const arrow = h.querySelector('.sort-arrow');
      if (h.dataset.col === sortCol) arrow.textContent = sortAsc ? '▲' : '▼';
      else arrow.textContent = '';
    });
  }

  sortTable();
})();

// === Force-directed graph ===
(function(){
  if (DATA.relations.length === 0) return;

  const svg = document.getElementById('graph-svg');
  const container = document.getElementById('graph-container');
  const tooltip = document.getElementById('tooltip');
  const NS = 'http://www.w3.org/2000/svg';

  // Build nodes and links from data
  const ticketMap = new Map();
  DATA.tickets.forEach(t => ticketMap.set(t.id, t));

  const nodeIds = new Set();
  DATA.relations.forEach(r => { nodeIds.add(r.sourceId); nodeIds.add(r.targetId); });

  const nodes = [];
  const nodeIndex = new Map();
  let i = 0;
  for (const id of nodeIds) {
    const t = ticketMap.get(id);
    if (!t) continue;
    nodeIndex.set(id, i);
    const w = container.clientWidth;
    const h = container.clientHeight;
    nodes.push({
      id, title: t.title, priority: t.priority, state: t.state,
      benefit: t.benefit, penalty: t.penalty, estimate: t.estimate, risk: t.risk,
      value: t.value, cost: t.cost, tags: t.tags,
      x: w / 2 + (Math.random() - 0.5) * w * 0.6,
      y: h / 2 + (Math.random() - 0.5) * h * 0.6,
      vx: 0, vy: 0
    });
    i++;
  }

  let links = DATA.relations.map(r => ({
    source: nodeIndex.get(r.sourceId),
    target: nodeIndex.get(r.targetId),
    type: r.type
  })).filter(l => l.source !== undefined && l.target !== undefined);

  let filteredLinks = links;

  // Color map
  const typeColors = {};
  const palette = ['#6366f1','#22c55e','#ef4444','#eab308','#06b6d4','#f97316','#ec4899','#8b5cf6','#14b8a6','#f43f5e','#a855f7','#84cc16'];
  const types = [...new Set(links.map(l => l.type))];
  types.forEach((t, i) => { typeColors[t] = palette[i % palette.length]; });

  const stateColors = { done: '#22c55e', wip: '#eab308', backlog: '#8b8fa3' };

  function nodeColor(n) { return stateColors[n.state] || '#6366f1'; }
  function nodeRadius(n) { return Math.max(8, Math.min(20, 6 + n.priority * 2.5)); }

  // Create SVG elements
  const defs = document.createElementNS(NS, 'defs');
  // Arrow markers per type
  types.forEach(t => {
    const marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', 'arrow-' + t.replace(/[^a-z0-9]/gi, '_'));
    marker.setAttribute('viewBox', '0 0 10 6');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M0,0 L10,3 L0,6 Z');
    path.setAttribute('fill', typeColors[t]);
    marker.appendChild(path);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  const edgeGroup = document.createElementNS(NS, 'g');
  const edgeLabelGroup = document.createElementNS(NS, 'g');
  const nodeGroup = document.createElementNS(NS, 'g');
  const labelGroup = document.createElementNS(NS, 'g');
  svg.appendChild(edgeGroup);
  svg.appendChild(edgeLabelGroup);
  svg.appendChild(nodeGroup);
  svg.appendChild(labelGroup);

  // Build SVG elements
  const edgeEls = [];
  const edgeLabelEls = [];
  const nodeEls = [];
  const textEls = [];

  function rebuild() {
    edgeGroup.innerHTML = '';
    edgeLabelGroup.innerHTML = '';
    nodeGroup.innerHTML = '';
    labelGroup.innerHTML = '';
    edgeEls.length = 0;
    edgeLabelEls.length = 0;
    nodeEls.length = 0;
    textEls.length = 0;

    filteredLinks.forEach(l => {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('stroke', typeColors[l.type] || '#444');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-opacity', '0.6');
      line.setAttribute('marker-end', 'url(#arrow-' + l.type.replace(/[^a-z0-9]/gi, '_') + ')');
      edgeGroup.appendChild(line);
      edgeEls.push(line);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('fill', typeColors[l.type] || '#888');
      label.setAttribute('font-size', '9');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '-4');
      label.setAttribute('opacity', '0.7');
      label.textContent = l.type;
      edgeLabelGroup.appendChild(label);
      edgeLabelEls.push(label);
    });

    nodes.forEach((n, i) => {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', nodeRadius(n));
      circle.setAttribute('fill', nodeColor(n));
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('cursor', 'grab');
      circle.setAttribute('opacity', '0.9');
      circle.dataset.idx = i;
      nodeGroup.appendChild(circle);
      nodeEls.push(circle);

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('fill', '#e1e4ed');
      text.setAttribute('font-size', '11');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', nodeRadius(n) + 14);
      text.setAttribute('pointer-events', 'none');
      const title = n.title.length > 24 ? n.title.slice(0, 22) + '…' : n.title;
      text.textContent = title;
      labelGroup.appendChild(text);
      textEls.push(text);
    });
  }

  rebuild();

  // Force simulation
  const W = () => container.clientWidth;
  const H = () => container.clientHeight;
  const TARGET_LEN = 120;
  let running = true;
  let alpha = 1;

  function tick() {
    if (!running) return;
    const w = W(), h = H();
    const cx = w / 2, cy = h / 2;

    // Centering force
    nodes.forEach(n => {
      n.vx += (cx - n.x) * 0.001;
      n.vy += (cy - n.y) * 0.001;
    });

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = 800 / (dist * dist);
        let fx = dx / dist * force;
        let fy = dy / dist * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Attraction along edges
    filteredLinks.forEach(l => {
      const s = nodes[l.source], t = nodes[l.target];
      let dx = t.x - s.x;
      let dy = t.y - s.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let force = (dist - TARGET_LEN) * 0.005;
      let fx = dx / dist * force;
      let fy = dy / dist * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    });

    // Apply velocity with damping
    const damping = 0.85;
    nodes.forEach(n => {
      if (n.dragging) return;
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
      // Boundary constraints
      const r = nodeRadius(n) + 4;
      n.x = Math.max(r, Math.min(w - r, n.x));
      n.y = Math.max(r, Math.min(h - r, n.y));
    });

    alpha *= 0.998;
    if (alpha < 0.01) alpha = 0.01;

    render();
    requestAnimationFrame(tick);
  }

  function render() {
    filteredLinks.forEach((l, i) => {
      const s = nodes[l.source], t = nodes[l.target];
      // Shorten line to stop at node edge
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const sr = nodeRadius(s) + 2, tr = nodeRadius(t) + 10;
      edgeEls[i].setAttribute('x1', s.x + dx / dist * sr);
      edgeEls[i].setAttribute('y1', s.y + dy / dist * sr);
      edgeEls[i].setAttribute('x2', t.x - dx / dist * tr);
      edgeEls[i].setAttribute('y2', t.y - dy / dist * tr);
      edgeLabelEls[i].setAttribute('x', (s.x + t.x) / 2);
      edgeLabelEls[i].setAttribute('y', (s.y + t.y) / 2);
    });

    nodes.forEach((n, i) => {
      nodeEls[i].setAttribute('cx', n.x);
      nodeEls[i].setAttribute('cy', n.y);
      textEls[i].setAttribute('x', n.x);
      textEls[i].setAttribute('y', n.y);
    });
  }

  requestAnimationFrame(tick);

  // Drag interaction
  let dragNode = null;
  let dragOffset = { x: 0, y: 0 };

  svg.addEventListener('mousedown', e => {
    const el = e.target.closest('circle');
    if (!el) return;
    const idx = parseInt(el.dataset.idx);
    dragNode = nodes[idx];
    dragNode.dragging = true;
    const rect = svg.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left - dragNode.x;
    dragOffset.y = e.clientY - rect.top - dragNode.y;
    el.setAttribute('cursor', 'grabbing');
    alpha = 0.3;
  });

  window.addEventListener('mousemove', e => {
    if (!dragNode) return;
    const rect = svg.getBoundingClientRect();
    dragNode.x = e.clientX - rect.left - dragOffset.x;
    dragNode.y = e.clientY - rect.top - dragOffset.y;
    dragNode.vx = 0;
    dragNode.vy = 0;
  });

  window.addEventListener('mouseup', () => {
    if (dragNode) {
      dragNode.dragging = false;
      dragNode = null;
    }
  });

  // Tooltip
  nodeEls.forEach((el, i) => {
    el.addEventListener('mouseenter', e => {
      const n = nodes[i];
      const rect = container.getBoundingClientRect();
      tooltip.innerHTML = '<h4>' + escHtml(n.title) + '</h4>'
        + '<div class="scores">'
        + '<span>Benefit: ' + n.benefit + '</span><span>Penalty: ' + n.penalty + '</span>'
        + '<span>Estimate: ' + n.estimate + '</span><span>Risk: ' + n.risk + '</span>'
        + '<span>Value: ' + n.value + '</span><span>Cost: ' + n.cost + '</span>'
        + '</div>'
        + '<div style="margin-top:.35rem">Priority: <strong>' + n.priority.toFixed(2) + '</strong></div>'
        + '<div style="margin-top:.25rem">State: <strong>' + escHtml(n.state) + '</strong></div>'
        + (n.tags.length > 0 ? '<div style="margin-top:.35rem">' + n.tags.map(t => '<span class="tag">' + escHtml(t) + '</span>').join('') + '</div>' : '');
      tooltip.style.display = 'block';
      const tx = n.x + 20, ty = n.y - 20;
      tooltip.style.left = Math.min(tx, container.clientWidth - 290) + 'px';
      tooltip.style.top = Math.max(0, ty) + 'px';
    });
    el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  });

  // Filter buttons
  document.querySelectorAll('.graph-controls button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.graph-controls button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      filteredLinks = filter === 'all' ? links : links.filter(l => l.type === filter);
      alpha = 0.5;
      rebuild();
      // Re-bind tooltips
      nodeEls.forEach((el, i) => {
        el.addEventListener('mouseenter', e => {
          const n = nodes[i];
          tooltip.innerHTML = '<h4>' + escHtml(n.title) + '</h4>'
            + '<div class="scores">'
            + '<span>Benefit: ' + n.benefit + '</span><span>Penalty: ' + n.penalty + '</span>'
            + '<span>Estimate: ' + n.estimate + '</span><span>Risk: ' + n.risk + '</span>'
            + '<span>Value: ' + n.value + '</span><span>Cost: ' + n.cost + '</span>'
            + '</div>'
            + '<div style="margin-top:.35rem">Priority: <strong>' + n.priority.toFixed(2) + '</strong></div>'
            + '<div style="margin-top:.25rem">State: <strong>' + escHtml(n.state) + '</strong></div>'
            + (n.tags.length > 0 ? '<div style="margin-top:.35rem">' + n.tags.map(t => '<span class="tag">' + escHtml(t) + '</span>').join('') + '</div>' : '');
          tooltip.style.display = 'block';
          const tx = n.x + 20, ty = n.y - 20;
          tooltip.style.left = Math.min(tx, container.clientWidth - 290) + 'px';
          tooltip.style.top = Math.max(0, ty) + 'px';
        });
        el.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
      });
    });
  });

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
})();
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stateClass(state: string): string {
  if (state === "done") return "done";
  if (state === "wip") return "wip";
  if (state === "backlog") return "backlog";
  return "default";
}

function ratioColor(ratio: number | undefined): string {
  if (ratio === undefined) return "";
  if (ratio >= 1) return "green";
  if (ratio >= 0.5) return "yellow";
  return "red";
}

function stateBreakdown(data: DashboardData): string {
  const entries = Object.entries(data.summary.byState);
  if (entries.length === 0) return '<div class="empty">No tickets.</div>';
  const total = data.summary.totalTickets;
  return entries
    .map(([state, count]) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `<div class="bar-row">
<span class="bar-label">${esc(state)}</span>
<div class="bar-track"><div class="bar-fill benefit" style="width:${pct}%"></div></div>
<span class="bar-count">${count}</span>
</div>`;
    })
    .join("");
}

function topPriority(data: DashboardData): string {
  if (data.summary.topByPriority.length === 0)
    return '<div class="empty">No tickets.</div>';
  return `<table><thead><tr><th>#</th><th>Title</th><th>Priority</th></tr></thead><tbody>
${data.summary.topByPriority
  .map(
    (t, i) =>
      `<tr><td>${i + 1}</td><td>${esc(t.title)}</td><td>${t.priority.toFixed(2)}</td></tr>`
  )
  .join("")}
</tbody></table>`;
}

function distributionBars(data: DashboardData): string {
  if (data.distribution.every((d) => Object.values(d.counts).every((c) => c === 0))) {
    return '<div class="empty">No tickets.</div>';
  }
  const fibs = [1, 2, 3, 5, 8, 13, 21];
  const maxCount = Math.max(
    ...data.distribution.flatMap((d) => fibs.map((f) => d.counts[f] || 0)),
    1
  );

  return data.distribution
    .map(
      (d) => `<div class="dist-section"><h3>${esc(d.dimension)}</h3>
${fibs
  .map((f) => {
    const count = d.counts[f] || 0;
    const pct = Math.round((count / maxCount) * 100);
    return `<div class="bar-row">
<span class="bar-label">${f}</span>
<div class="bar-track"><div class="bar-fill ${d.dimension}" style="width:${pct}%"></div></div>
<span class="bar-count">${count}</span>
</div>`;
  })
  .join("")}
</div>`
    )
    .join("");
}

function uniqueTypes(data: DashboardData): string[] {
  return [...new Set(data.relations.map((r) => r.type))];
}
