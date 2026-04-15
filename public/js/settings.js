// ─── State ───────────────────────────────────────────────────────────────────
let _map        = null;
let _addMode    = false;
let _tempCircle = null;
let _baseLayerMap = {}; // id → { circle, label }

// ─── Boot ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initBasesMap();        // map always starts with bases tab active
  loadBasesTab();
  loadGroupsTab();
  loadTimeConfig();

  document.getElementById('btnAddBase').addEventListener('click', enableAddMode);
  document.getElementById('btnCancelAdd').addEventListener('click', disableAddMode);
  document.getElementById('btnSaveGroup').addEventListener('click', saveGroup);
  document.getElementById('btnCancelEdit').addEventListener('click', cancelGroupEdit);
  document.getElementById('btnSaveTime').addEventListener('click', saveTimeConfig);
  document.getElementById('timeFrom').addEventListener('input', updateTimeCrossWarning);
  document.getElementById('timeTo').addEventListener('input', updateTimeCrossWarning);
});

// ─── Tabs ────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      // Invalidate map size when switching to bases tab (Leaflet needs this)
      if (tab.dataset.tab === 'tab-bases' && _map) {
        setTimeout(() => _map.invalidateSize(), 50);
      }
    });
  });
}

// ─── Bases Map ───────────────────────────────────────────────────────────────
function initBasesMap() {
  _map = L.map('settings-map').setView([-15.8, -47.9], 5);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(_map);

  _map.on('click', e => {
    if (_addMode) showAddBasePopup(e.latlng);
  });
}

async function loadBasesTab() {
  const res   = await fetch('/api/bases');
  const bases = await res.json();
  renderBaseCircles(bases);
  renderBasesList(bases);
}

function renderBaseCircles(bases) {
  // Remove old layers
  Object.values(_baseLayerMap).forEach(({ circle, label }) => {
    _map.removeLayer(circle);
    _map.removeLayer(label);
  });
  _baseLayerMap = {};

  bases.forEach(base => {
    const circle = L.circle([base.lat, base.lng], {
      radius: base.raio, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 2
    }).addTo(_map);

    const label = L.marker([base.lat, base.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="color:#3b82f6;font-size:11px;font-weight:700;white-space:nowrap;
                            text-shadow:0 1px 3px rgba(255,255,255,.9)">${base.nome}</div>`,
        iconAnchor: [0, -4]
      }),
      interactive: false
    }).addTo(_map);

    circle.on('click', () => showEditBasePopup(base, circle));
    _baseLayerMap[base.id] = { circle, label };
  });
}

function renderBasesList(bases) {
  const container = document.getElementById('bases-list');
  if (bases.length === 0) {
    container.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">Nenhuma base cadastrada.</p>';
    return;
  }
  container.innerHTML = bases.map(b => `
    <div class="group-item" style="margin-bottom:5px">
      <div>
        <div class="group-item-name">${b.nome}</div>
        <div class="group-item-count">Raio: ${b.raio}m</div>
      </div>
      <button class="btn-danger" onclick="deleteBase('${b.id}', '${b.nome}')">Excluir</button>
    </div>
  `).join('');
}

function enableAddMode() {
  _addMode = true;
  _map.getContainer().style.cursor = 'crosshair';
  document.getElementById('addModeHint').style.display = 'block';
  document.getElementById('btnAddBase').disabled = true;
}

function disableAddMode() {
  _addMode = false;
  _map.getContainer().style.cursor = '';
  document.getElementById('addModeHint').style.display = 'none';
  document.getElementById('btnAddBase').disabled = false;
  if (_tempCircle) { _map.removeLayer(_tempCircle); _tempCircle = null; }
  _map.closePopup();
}

function showAddBasePopup(latlng) {
  const { lat, lng } = latlng;

  if (_tempCircle) _map.removeLayer(_tempCircle);
  _tempCircle = L.circle([lat, lng], {
    radius: 300, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.2, weight: 2, dashArray: '6 4'
  }).addTo(_map);

  const div = document.createElement('div');
  div.style.minWidth = '190px';
  div.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;color:#0f172a">Nova Base</div>
    <input id="newBaseName" placeholder="Nome da base"
      style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:12px;margin-bottom:6px;outline:none" />
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <label style="font-size:11px;color:#64748b;flex-shrink:0">Raio (m):</label>
      <input id="newBaseRadius" type="number" value="300" min="50" max="10000"
        style="width:80px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:12px;outline:none" />
    </div>
    <div style="display:flex;gap:6px">
      <button id="btnConfirmAdd"
        style="flex:1;padding:7px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">
        Salvar
      </button>
      <button id="btnCancelAddPopup"
        style="padding:7px 10px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;cursor:pointer">
        Cancelar
      </button>
    </div>
  `;

  const popup = L.popup({ closeButton: false })
    .setLatLng([lat, lng])
    .setContent(div)
    .openOn(_map);

  div.querySelector('#newBaseRadius').addEventListener('input', e => {
    _tempCircle.setRadius(Number(e.target.value) || 300);
  });

  div.querySelector('#btnConfirmAdd').addEventListener('click', async () => {
    const nome = div.querySelector('#newBaseName').value.trim();
    const raio = Number(div.querySelector('#newBaseRadius').value) || 300;
    if (!nome) { div.querySelector('#newBaseName').style.borderColor = '#ef4444'; return; }
    await fetch('/api/bases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, lat, lng, raio })
    });
    disableAddMode();
    loadBasesTab();
  });

  div.querySelector('#btnCancelAddPopup').addEventListener('click', disableAddMode);
}

function showEditBasePopup(base, circle) {
  const div = document.createElement('div');
  div.style.minWidth = '190px';
  div.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;color:#0f172a">Editar Base</div>
    <input id="editBaseName" value="${base.nome}"
      style="width:100%;padding:5px 8px;border:1px solid #cbd5e1;border-radius:5px;font-size:12px;margin-bottom:6px;outline:none" />
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <label style="font-size:11px;color:#64748b;flex-shrink:0">Raio (m):</label>
      <input id="editBaseRadius" type="number" value="${base.raio}"
        style="width:80px;padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:12px;outline:none" />
    </div>
    <div style="display:flex;gap:6px">
      <button id="btnConfirmEdit"
        style="flex:1;padding:7px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">
        Salvar
      </button>
      <button id="btnDeleteBase"
        style="padding:7px 10px;background:#fef2f2;color:#ef4444;border:1px solid #fecaca;border-radius:6px;font-size:12px;cursor:pointer">
        Excluir
      </button>
    </div>
  `;

  L.popup({ closeButton: true })
    .setLatLng([base.lat, base.lng])
    .setContent(div)
    .openOn(_map);

  div.querySelector('#editBaseRadius').addEventListener('input', e => {
    circle.setRadius(Number(e.target.value) || base.raio);
  });

  div.querySelector('#btnConfirmEdit').addEventListener('click', async () => {
    const nome = div.querySelector('#editBaseName').value.trim();
    const raio = Number(div.querySelector('#editBaseRadius').value) || base.raio;
    if (!nome) return;
    await fetch(`/api/bases/${base.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, raio })
    });
    _map.closePopup();
    loadBasesTab();
  });

  div.querySelector('#btnDeleteBase').addEventListener('click', () => deleteBase(base.id, base.nome));
}

async function deleteBase(id, nome) {
  if (!confirm(`Excluir a base "${nome}"?`)) return;
  await fetch(`/api/bases/${id}`, { method: 'DELETE' });
  _map.closePopup();
  loadBasesTab();
}

// ─── Groups Tab ──────────────────────────────────────────────────────────────
async function loadGroupsTab() {
  const [groupsRes, vehiclesRes] = await Promise.all([
    fetch('/api/groups'),
    fetch('/api/vehicles/list')
  ]);
  const groups   = await groupsRes.json();
  const vehicles = await vehiclesRes.json();
  renderGroupsList(groups);
  populatePlateSelect(vehicles, []);
}

function renderGroupsList(groups) {
  const container = document.getElementById('groups-list');
  if (groups.length === 0) {
    container.innerHTML = '<p style="font-size:11px;color:var(--text-muted)">Nenhum grupo cadastrado.</p>';
    return;
  }
  container.innerHTML = groups.map(g => `
    <div class="group-item">
      <div>
        <div class="group-item-name">${g.nome}</div>
        <div class="group-item-count">${g.placas.length} veículo(s)</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-sm" onclick="startEditGroup('${g.id}')">Editar</button>
        <button class="btn-danger" onclick="deleteGroup('${g.id}', '${g.nome}')">Excluir</button>
      </div>
    </div>
  `).join('');
}

function populatePlateSelect(vehicles, selectedPlates) {
  const select = document.getElementById('groupPlates');
  select.innerHTML = vehicles.map(v =>
    `<option value="${v.plate}" ${selectedPlates.includes(v.plate) ? 'selected' : ''}>${v.plate}</option>`
  ).join('');
}

async function saveGroup() {
  const nome   = document.getElementById('groupName').value.trim();
  const placas = Array.from(document.getElementById('groupPlates').selectedOptions).map(o => o.value);
  if (!nome)            { alert('Informe o nome do grupo.');          return; }
  if (placas.length === 0) { alert('Selecione ao menos um veículo.'); return; }

  const editId = document.getElementById('groupForm').dataset.editId;
  if (editId) {
    await fetch(`/api/groups/${editId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, placas })
    });
  } else {
    await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, placas })
    });
  }
  cancelGroupEdit();
  loadGroupsTab();
}

async function startEditGroup(id) {
  const res    = await fetch('/api/groups');
  const groups = await res.json();
  const group  = groups.find(g => g.id === id);
  if (!group) return;

  document.getElementById('groupName').value = group.nome;
  document.getElementById('groupForm').dataset.editId = id;
  document.getElementById('groupFormLabel').textContent = 'Editar Grupo';
  document.getElementById('btnSaveGroup').textContent   = 'Salvar Alterações';
  document.getElementById('btnCancelEdit').style.display = 'block';

  // Mark selected plates
  Array.from(document.getElementById('groupPlates').options).forEach(opt => {
    opt.selected = group.placas.includes(opt.value);
  });
  document.getElementById('groupForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelGroupEdit() {
  document.getElementById('groupName').value = '';
  document.getElementById('groupForm').dataset.editId = '';
  document.getElementById('groupFormLabel').textContent = 'Novo Grupo';
  document.getElementById('btnSaveGroup').textContent   = 'Adicionar Grupo';
  document.getElementById('btnCancelEdit').style.display = 'none';
  Array.from(document.getElementById('groupPlates').options).forEach(o => { o.selected = false; });
}

async function deleteGroup(id, nome) {
  if (!confirm(`Excluir grupo "${nome}"?`)) return;
  await fetch(`/api/groups/${id}`, { method: 'DELETE' });
  loadGroupsTab();
}

// ─── Time Tab ─────────────────────────────────────────────────────────────────
async function loadTimeConfig() {
  const res    = await fetch('/api/overnight/config');
  const config = await res.json();
  document.getElementById('timeFrom').value = config.from;
  document.getElementById('timeTo').value   = config.to;
  updateTimeCrossWarning();
}

function updateTimeCrossWarning() {
  const from = document.getElementById('timeFrom').value;
  const to   = document.getElementById('timeTo').value;
  const warn = document.getElementById('timeCrossWarn');
  if (from && to) {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    const crosses  = fh > th || (fh === th && fm >= tm);
    warn.style.display = crosses ? 'block' : 'none';
  }
}

async function saveTimeConfig() {
  const from = document.getElementById('timeFrom').value;
  const to   = document.getElementById('timeTo').value;
  if (!from || !to) return;
  await fetch('/api/overnight/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to })
  });
  const msg = document.getElementById('timeSaveMsg');
  msg.textContent = '✓ Salvo!';
  setTimeout(() => { msg.textContent = ''; }, 2000);
}
