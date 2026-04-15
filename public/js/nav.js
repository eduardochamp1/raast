// Shared navigation component injected into every page.
// Call: initNav('map' | 'overnight' | 'settings')

function initNav(activePage) {
  const nav = document.getElementById('page-nav');
  if (!nav) return;

  nav.innerHTML = `
    <div class="page-nav">
      <a href="/" class="nav-tab ${activePage === 'map'       ? 'active' : ''}">🗺️ Mapa</a>
      <a href="/overnight.html" class="nav-tab ${activePage === 'overnight' ? 'active' : ''}">
        🌙 Pernoite <span class="nav-badge" id="alertBadge" style="display:none"></span>
      </a>
      <a href="/settings.html" class="nav-tab ${activePage === 'settings'  ? 'active' : ''}">⚙️ Config</a>
      <button class="nav-bell" id="navBell" title="Alertas de pernoite">🔔</button>
    </div>
    <div class="alert-panel" id="alertPanel">
      <div class="alert-panel-header">
        <span>Alertas de Pernoite</span>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn-mark-all" id="btnMarkAll">Marcar todos como vistos</button>
          <button class="alert-panel-close" id="alertPanelClose">✕</button>
        </div>
      </div>
      <div class="alert-list" id="alertList">
        <p style="padding:12px;color:var(--text-muted);font-size:12px">Carregando...</p>
      </div>
    </div>
  `;

  _loadAlertCount();
  document.getElementById('navBell').addEventListener('click', _openAlertPanel);
  document.getElementById('alertPanelClose').addEventListener('click', () => {
    document.getElementById('alertPanel').classList.remove('open');
  });
  document.getElementById('btnMarkAll').addEventListener('click', _markAllSeen);
}

async function _loadAlertCount() {
  try {
    const res   = await fetch('/api/overnight/alerts/count');
    const { count } = await res.json();
    const badge = document.getElementById('alertBadge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
    else           { badge.style.display = 'none'; }
  } catch { /* silent */ }
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function _openAlertPanel() {
  const panel = document.getElementById('alertPanel');
  panel.classList.add('open');
  const list = document.getElementById('alertList');
  list.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:12px">Carregando...</p>';

  try {
    const res    = await fetch('/api/overnight/alerts');
    const alerts = await res.json();
    if (alerts.length === 0) {
      list.innerHTML = '<p style="padding:12px;color:var(--text-muted);font-size:12px">Nenhum alerta pendente. ✅</p>';
      return;
    }
    list.innerHTML = alerts.map(a => `
      <div class="alert-item">
        <div class="alert-item-plate">${_esc(a.placa)}</div>
        <div class="alert-item-info">${_esc(a.grupo)} · ${_esc(a.data)}</div>
        ${a.lat != null ? `<div class="alert-item-info">📍 ${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}</div>` : ''}
        <a href="/overnight.html?date=${_esc(a.data)}" class="alert-item-link">Ver no relatório →</a>
      </div>
    `).join('');
  } catch {
    list.innerHTML = '<p style="padding:12px;color:#fca5a5;font-size:12px">Erro ao carregar alertas.</p>';
  }
}

async function _markAllSeen() {
  try {
    await fetch('/api/overnight/alerts/visto-todos', { method: 'PATCH' });
    document.getElementById('alertPanel').classList.remove('open');
    _loadAlertCount();
  } catch { /* silent */ }
}
