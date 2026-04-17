// ─── State ────────────────────────────────────────────────────────────────────
let _map         = null;
let _markers     = [];
let _baseCircles = [];
let _lastData    = [];   // kept for XLSX export

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await Promise.all([loadGroups(), loadBases()]);

  // Pre-fill date from alert panel redirect: /overnight.html?date=2026-04-15
  const params    = new URLSearchParams(window.location.search);
  const dateParam = params.get('date');
  if (dateParam) {
    document.getElementById('dateStart').value = dateParam;
    document.getElementById('dateEnd').value   = dateParam;
  }

  document.getElementById('btnGenerate').addEventListener('click',  generateReport);
  document.getElementById('btnExportXlsx').addEventListener('click', exportXlsx);
});

// ─── Map init ─────────────────────────────────────────────────────────────────
function initMap() {
  _map = L.map('overnight-map').setView([-15.8, -47.9], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(_map);
}

// ─── Load groups into select ──────────────────────────────────────────────────
async function loadGroups() {
  try {
    const res    = await fetch('/api/groups');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const groups = await res.json();
    const select = document.getElementById('groupSelect');
    if (groups.length === 0) {
      select.innerHTML = '<option value="">Nenhum grupo cadastrado</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione um grupo...</option>'
      + groups.map(g => `<option value="${_esc(g.id)}">${_esc(g.nome)}</option>`).join('');
  } catch (err) {
    console.error('[overnight] loadGroups:', err);
    document.getElementById('groupSelect').innerHTML = '<option value="">Erro ao carregar grupos</option>';
  }
}

// ─── Draw base circles (always visible) ──────────────────────────────────────
async function loadBases() {
  try {
    const res   = await fetch('/api/bases');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bases = await res.json();
    _baseCircles.forEach(c => _map.removeLayer(c));
    _baseCircles = [];
    bases.forEach(base => {
      const circle = L.circle([base.lat, base.lng], {
        radius: base.raio, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.12, weight: 2
      }).bindTooltip(base.nome, { permanent: false }).addTo(_map);
      _baseCircles.push(circle);
    });
  } catch (err) {
    // Base circles are decorative; fail silently so it doesn't block report usage
    console.error('[overnight] loadBases:', err);
  }
}

// ─── Generate report ─────────────────────────────────────────────────────────
async function generateReport() {
  const groupId = document.getElementById('groupSelect').value;
  const start   = document.getElementById('dateStart').value;
  const end     = document.getElementById('dateEnd').value;

  const errDiv = document.getElementById('reportError');
  errDiv.style.display = 'none';

  if (!groupId) { errDiv.textContent = 'Selecione um grupo.';                 errDiv.style.display = 'block'; return; }
  if (!start)   { errDiv.textContent = 'Informe a data de início.';           errDiv.style.display = 'block'; return; }
  if (!end)     { errDiv.textContent = 'Informe a data de fim.';              errDiv.style.display = 'block'; return; }
  if (start > end) { errDiv.textContent = 'A data de início deve ser ≤ fim.'; errDiv.style.display = 'block'; return; }

  const btn     = document.getElementById('btnGenerate');
  const overlay = document.getElementById('loadingOverlay');
  btn.disabled  = true;
  overlay.style.display = 'flex';

  try {
    const res  = await fetch(`/api/overnight/report?groupId=${encodeURIComponent(groupId)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
    if (!res.ok) {
      let msg = 'Erro no servidor';
      try { msg = (await res.json()).error || msg; } catch { /* non-JSON body */ }
      throw new Error(msg);
    }
    const data = await res.json();
    _lastData  = data;
    renderTable(data);
    renderMarkers(data);
  } catch (err) {
    errDiv.textContent    = `Erro: ${err.message}`;
    errDiv.style.display  = 'block';
  } finally {
    btn.disabled          = false;
    overlay.style.display = 'none';
  }
}

// ─── Table ───────────────────────────────────────────────────────────────────
function renderTable(data) {
  const table = document.getElementById('reportTable');
  const tbody = document.getElementById('reportTbody');

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:12px">
      Sem dados para o período selecionado.</td></tr>`;
    table.style.display = 'table';
    document.getElementById('btnExportXlsx').style.display = 'none';
    return;
  }

  tbody.innerHTML = data.map(row => {
    let badge, local;
    if (row.situacao === 'base') {
      badge = `<span class="badge-base">✅ Base</span>`;
      local = _esc(row.base || '—');
    } else if (row.situacao === 'fora') {
      badge = `<span class="badge-fora">❌ Fora</span>`;
      local = row.lat != null
        ? `<a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank"
              style="color:#3b82f6;font-size:10px">${row.lat.toFixed(4)}, ${row.lng.toFixed(4)}</a>`
        : '—';
    } else {
      badge = `<span class="badge-sem-dados">— ${row.situacao === 'erro' ? 'Erro' : 'Sem dados'}</span>`;
      local = '—';
    }
    return `<tr><td>${_esc(row.placa)}</td><td>${_esc(row.data)}</td><td>${badge}</td><td>${local}</td></tr>`;
  }).join('');

  table.style.display = 'table';
  document.getElementById('btnExportXlsx').style.display = 'block';
}

// ─── Map markers ─────────────────────────────────────────────────────────────
function renderMarkers(data) {
  _markers.forEach(m => _map.removeLayer(m));
  _markers = [];
  const bounds = [];

  data.forEach(row => {
    if (row.lat == null || row.lng == null) return;
    const isBase = row.situacao === 'base';
    const color  = isBase ? '#22c55e' : '#ef4444';
    const marker = L.circleMarker([row.lat, row.lng], {
      radius: 8, color, fillColor: color, fillOpacity: 0.9, weight: 2
    }).bindPopup(`
      <div class="popup-plate">${_esc(row.placa)}</div>
      <div class="popup-row">📅 Data: <span>${_esc(row.data)}</span></div>
      <div class="popup-row">${isBase
        ? `✅ Base: <span>${_esc(row.base)}</span>`
        : `❌ Fora da base`}
      </div>
      ${!isBase ? `<div class="popup-row">
        <a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" style="color:#3b82f6">
          Ver no Google Maps
        </a></div>` : ''}
    `).addTo(_map);
    _markers.push(marker);
    bounds.push([row.lat, row.lng]);
  });

  if (bounds.length > 0) {
    _map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
  }
}

// ─── XLSX Export ──────────────────────────────────────────────────────────────
function exportXlsx() {
  if (_lastData.length === 0) return;
  if (typeof XLSX === 'undefined') {
    alert('Biblioteca XLSX não carregada. Verifique sua conexão.');
    return;
  }
  const rows = [['Placa', 'Data', 'Situação', 'Base', 'Lat', 'Lng']];
  _lastData.forEach(r => {
    rows.push([r.placa, r.data, r.situacao, r.base ?? '', r.lat ?? '', r.lng ?? '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pernoite');
  XLSX.writeFile(wb, `pernoite-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
