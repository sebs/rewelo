export function loginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rewelo - login</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --bg: #0f172a; --surface: #1e293b; --border: #475569; --text: #f1f5f9; --text-muted: #94a3b8; --blue: #3b82f6; --red: #ef4444; }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh;
         display: flex; align-items: center; justify-content: center; }
  .login-box { background: var(--surface); border-radius: 12px; padding: 32px; width: 100%; max-width: 380px;
               border: 1px solid var(--border); }
  h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 8px; }
  p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 20px; }
  label { font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 12px; background: var(--bg); color: var(--text); border: 1px solid var(--border);
          border-radius: 6px; font-size: 0.9rem; margin-bottom: 16px; }
  input:focus { outline: none; border-color: var(--blue); }
  button { width: 100%; padding: 10px; background: var(--blue); color: white; border: none; border-radius: 6px;
           font-size: 0.9rem; font-weight: 600; cursor: pointer; }
  button:hover { opacity: 0.9; }
  .error { color: var(--red); font-size: 0.8rem; margin-bottom: 12px; display: none; }
</style>
</head>
<body>
<div class="login-box">
  <h1>rewelo</h1>
  <p>Enter your token to access the dashboard.</p>
  <div class="error" id="error"></div>
  <form id="login-form">
    <label for="token">Bearer token</label>
    <input type="password" id="token" name="token" placeholder="rw_..." autocomplete="off" required>
    <button type="submit">Sign in</button>
  </form>
</div>
<script>
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = document.getElementById('token').value.trim();
  const errorEl = document.getElementById('error');
  errorEl.style.display = 'none';
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      const data = await res.json();
      errorEl.textContent = data.error || 'Invalid token';
      errorEl.style.display = 'block';
    }
  } catch {
    errorEl.textContent = 'Connection error';
    errorEl.style.display = 'block';
  }
});
<\/script>
</body>
</html>`;
}

export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rewelo dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f172a; --surface: #1e293b; --surface-2: #334155;
    --border: #475569; --text: #f1f5f9; --text-muted: #94a3b8;
    --blue: #3b82f6; --orange: #f97316; --teal: #14b8a6;
    --green: #22c55e; --red: #ef4444; --purple: #a855f7;
  }
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .toolbar {
    display: flex; gap: 12px; align-items: center; padding: 16px 24px;
    background: var(--surface); border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .toolbar h1 { font-size: 1.25rem; font-weight: 700; margin-right: auto; }
  .toolbar select {
    background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 12px; font-size: 0.875rem; cursor: pointer;
  }
  .toolbar select:hover { border-color: var(--blue); }
  .toolbar label { font-size: 0.8rem; color: var(--text-muted); }
  .grid { display: grid; gap: 24px; padding: 24px; }
  @media (min-width: 1024px) { .grid { grid-template-columns: 1fr 1fr; } }
</style>
</head>
<body>

<div class="toolbar">
  <h1>rewelo</h1>
  <label for="project-select">Project</label>
  <select id="project-select"></select>
  <label for="sprint-select">Sprint</label>
  <select id="sprint-select"><option value="">All tickets</option></select>
</div>

<div class="grid">
  <rw-cfd-chart></rw-cfd-chart>
  <rw-kanban-board style="grid-column: 1 / -1;"></rw-kanban-board>
</div>

<script>
// ---------------------------------------------------------------------------
//  <rw-cfd-chart> — Cumulative Flow Diagram (Chart.js stacked area)
// ---------------------------------------------------------------------------
class RwCfdChart extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._chart = null; }

  connectedCallback() {
    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; background: var(--surface, #1e293b); border-radius: 8px; padding: 16px; }
        h2 { font-size: 1.1rem; font-weight: 600; color: var(--text, #f1f5f9); margin-bottom: 12px; }
        .chart-wrap { position: relative; height: 280px; }
        canvas { width: 100% !important; height: 100% !important; }
        .empty { display: flex; align-items: center; justify-content: center; height: 100%;
                 color: var(--text-muted, #94a3b8); font-size: 0.9rem; }
      </style>
      <h2>Cumulative Flow Diagram</h2>
      <div class="chart-wrap"><canvas id="cfd"></canvas></div>
    \`;
  }

  set data(points) {
    this._data = points;
    this._render();
  }

  _render() {
    const canvas = this.shadowRoot.querySelector('#cfd');
    if (!canvas || !this._data) return;

    const labels = this._data.map(p => p.date);
    const datasets = [
      {
        label: 'Done', data: this._data.map(p => p.done),
        backgroundColor: 'rgba(59, 130, 246, 0.6)', borderColor: '#3b82f6',
        borderWidth: 2, fill: 'origin', stack: 'cfd',
      },
      {
        label: 'WIP', data: this._data.map(p => p.wip),
        backgroundColor: 'rgba(249, 115, 22, 0.6)', borderColor: '#f97316',
        borderWidth: 2, fill: '-1', stack: 'cfd',
      },
      {
        label: 'Backlog', data: this._data.map(p => p.backlog),
        backgroundColor: 'rgba(20, 184, 166, 0.6)', borderColor: '#14b8a6',
        borderWidth: 2, fill: '-1', stack: 'cfd',
      },
    ];

    const opts = {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#94a3b8', maxRotation: 45 } },
        y: { stacked: true, beginAtZero: true, min: 0,
             grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: '#94a3b8' } },
      },
      plugins: {
        legend: { labels: { color: '#f1f5f9' } },
        tooltip: { mode: 'index', intersect: false },
      },
    };

    if (this._chart) {
      this._chart.data.labels = labels;
      this._chart.data.datasets = datasets;
      this._chart.update();
    } else {
      this._chart = new Chart(canvas, { type: 'line', data: { labels, datasets }, options: opts });
    }
  }

  disconnectedCallback() { if (this._chart) this._chart.destroy(); }
}
customElements.define('rw-cfd-chart', RwCfdChart);

// ---------------------------------------------------------------------------
//  <rw-ticket-card> — Single ticket card
// ---------------------------------------------------------------------------
class RwTicketCard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }

  set ticket(t) { this._ticket = t; this._render(); }

  _render() {
    const t = this._ticket;
    if (!t) return;
    const tags = (t.tags || []).map(tg => \`<span class="tag">\${tg.prefix}:\${tg.value}</span>\`).join('');
    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; }
        .card {
          background: var(--surface-2, #334155); border-radius: 6px; padding: 10px 12px;
          border-left: 3px solid var(--blue, #3b82f6); cursor: default;
          transition: transform 0.1s;
        }
        .card:hover { transform: translateY(-1px); }
        .title { font-size: 0.85rem; font-weight: 600; color: var(--text, #f1f5f9); margin-bottom: 4px; }
        .meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: 0.7rem; color: var(--text-muted, #94a3b8); }
        .meta span { background: var(--bg, #0f172a); padding: 2px 6px; border-radius: 3px; }
        .priority { color: var(--orange, #f97316); font-weight: 700; }
        .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
        .tag { font-size: 0.65rem; background: var(--bg, #0f172a); color: var(--teal, #14b8a6);
               padding: 1px 6px; border-radius: 3px; }
      </style>
      <div class="card">
        <div class="title">\${t.title}</div>
        <div class="meta">
          <span class="priority">P \${t.priority}</span>
          <span>B\${t.benefit}</span><span>P\${t.penalty}</span>
          <span>E\${t.estimate}</span><span>R\${t.risk}</span>
        </div>
        \${tags ? \`<div class="tags">\${tags}</div>\` : ''}
      </div>
    \`;
  }
}
customElements.define('rw-ticket-card', RwTicketCard);

// ---------------------------------------------------------------------------
//  <rw-kanban-board> — Kanban board with columns
// ---------------------------------------------------------------------------
class RwKanbanBoard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }

  connectedCallback() {
    this.shadowRoot.innerHTML = \`
      <style>
        :host { display: block; background: var(--surface, #1e293b); border-radius: 8px; padding: 16px; }
        h2 { font-size: 1.1rem; font-weight: 600; color: var(--text, #f1f5f9); margin-bottom: 12px; }
        .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
        @media (max-width: 768px) { .board { grid-template-columns: 1fr; } }
        .column { background: var(--bg, #0f172a); border-radius: 6px; padding: 12px; min-height: 200px; }
        .col-header {
          font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.05em; margin-bottom: 10px; padding-bottom: 8px;
          border-bottom: 2px solid var(--border, #475569);
          display: flex; justify-content: space-between; align-items: center;
        }
        .col-header .count {
          font-size: 0.7rem; font-weight: 400; background: var(--surface-2, #334155);
          padding: 2px 8px; border-radius: 10px;
        }
        .col-backlog .col-header { color: var(--teal, #14b8a6); border-color: var(--teal); }
        .col-wip .col-header { color: var(--orange, #f97316); border-color: var(--orange); }
        .col-done .col-header { color: var(--blue, #3b82f6); border-color: var(--blue); }
        .cards { display: flex; flex-direction: column; gap: 8px; }
        .empty-col { color: var(--text-muted, #94a3b8); font-size: 0.8rem; text-align: center; padding: 24px 0; }
      </style>
      <h2>Kanban Board</h2>
      <div class="board">
        <div class="column col-backlog">
          <div class="col-header">Backlog <span class="count" id="count-backlog">0</span></div>
          <div class="cards" id="col-backlog"></div>
        </div>
        <div class="column col-wip">
          <div class="col-header">In Progress <span class="count" id="count-wip">0</span></div>
          <div class="cards" id="col-wip"></div>
        </div>
        <div class="column col-done">
          <div class="col-header">Done <span class="count" id="count-done">0</span></div>
          <div class="cards" id="col-done"></div>
        </div>
      </div>
    \`;
  }

  set data(kanban) {
    this._data = kanban;
    this._render();
  }

  _render() {
    if (!this._data) return;
    const { columns } = this._data;

    for (const [state, tickets] of Object.entries(columns)) {
      const container = this.shadowRoot.querySelector(\`#col-\${state}\`);
      const counter = this.shadowRoot.querySelector(\`#count-\${state}\`);
      if (!container) continue;

      counter.textContent = tickets.length;
      container.innerHTML = '';

      if (tickets.length === 0) {
        container.innerHTML = '<div class="empty-col">No tickets</div>';
        continue;
      }

      for (const ticket of tickets) {
        const card = document.createElement('rw-ticket-card');
        card.ticket = ticket;
        container.appendChild(card);
      }
    }
  }
}
customElements.define('rw-kanban-board', RwKanbanBoard);

// ---------------------------------------------------------------------------
//  App controller — fetch data, wire selects
// ---------------------------------------------------------------------------
const projectSelect = document.getElementById('project-select');
const sprintSelect = document.getElementById('sprint-select');
const cfdChart = document.querySelector('rw-cfd-chart');
const kanbanBoard = document.querySelector('rw-kanban-board');

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadProjects() {
  const projects = await fetchJson('/api/projects');
  projectSelect.innerHTML = projects.map(p =>
    \`<option value="\${p.name}">\${p.name}</option>\`
  ).join('');
  if (projects.length > 0) {
    await loadProject(projects[0].name);
  }
}

async function loadProject(name) {
  // Load sprints
  const sprints = await fetchJson(\`/api/projects/\${encodeURIComponent(name)}/sprints\`);
  sprintSelect.innerHTML = '<option value="">All tickets</option>' +
    sprints.map(s => \`<option value="\${s}">\${s}</option>\`).join('');
  await loadData(name, '');
}

async function loadData(project, sprint) {
  const qs = sprint ? \`?sprint=\${encodeURIComponent(sprint)}\` : '';
  const [cfd, kanban] = await Promise.all([
    fetchJson(\`/api/projects/\${encodeURIComponent(project)}/cfd\${qs}\`),
    fetchJson(\`/api/projects/\${encodeURIComponent(project)}/kanban\${qs}\`),
  ]);
  cfdChart.data = cfd;
  kanbanBoard.data = kanban;
}

projectSelect.addEventListener('change', () => loadProject(projectSelect.value));
sprintSelect.addEventListener('change', () => loadData(projectSelect.value, sprintSelect.value));

loadProjects().catch(err => console.error('Dashboard init error:', err));
<\/script>
</body>
</html>`;
}
