// Estado do dropdown
let _allVehicles = [];      // [{ plate, integrationCode, status }]
let _selected   = new Set();
let _onChangeCb = null;

// NOTA: PALETTE é definida em map.js (carregado antes) — não redeclarar aqui

function initDropdown(vehicles, onChange) {
  _allVehicles = vehicles;
  _onChangeCb  = onChange;
  _renderList(_allVehicles);
  _bindEvents();
}

function _bindEvents() {
  const trigger   = document.getElementById('dropdownTrigger');
  const panel     = document.getElementById('dropdownPanel');
  const search    = document.getElementById('dropdownSearch');
  const selectAll = document.getElementById('selectAllBtn');
  const clearBtn  = document.getElementById('clearSelectionBtn');

  // Abrir/fechar
  trigger.addEventListener('click', (e) => {
    if (e.target.closest('.vehicle-tag')) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    trigger.classList.toggle('open', !open);
    document.getElementById('dropdownChevron').textContent = open ? '▼' : '▲';
    if (!open) search.focus();
  });

  // Fechar ao clicar fora
  document.addEventListener('click', (e) => {
    if (!document.getElementById('vehicleDropdown').contains(e.target)) {
      panel.style.display = 'none';
      trigger.classList.remove('open');
      document.getElementById('dropdownChevron').textContent = '▼';
    }
  });

  // ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      panel.style.display = 'none';
      trigger.classList.remove('open');
    }
  });

  // Busca
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    const filtered = _allVehicles.filter(v => v.plate.toLowerCase().includes(q));
    _renderList(filtered);
  });

  // Selecionar todos
  selectAll.addEventListener('click', () => {
    _allVehicles.forEach(v => _selected.add(v.plate));
    _renderList(_allVehicles);
    _updateTrigger();
    _onChangeCb && _onChangeCb(getSelectedPlates());
  });

  // Limpar
  clearBtn.addEventListener('click', () => {
    _selected.clear();
    _renderList(_allVehicles);
    _updateTrigger();
    _onChangeCb && _onChangeCb(getSelectedPlates());
  });
}

function _renderList(vehicles) {
  const list = document.getElementById('dropdownList');
  list.innerHTML = '';

  if (vehicles.length === 0) {
    list.innerHTML = '<div class="dropdown-loading">Nenhum veículo encontrado</div>';
    return;
  }

  vehicles.forEach(v => {
    const selected = _selected.has(v.plate);
    const idx = Array.from(_selected).indexOf(v.plate);
    const color = selected ? PALETTE[idx % PALETTE.length] : '#334155';

    const item = document.createElement('div');
    item.className = `dropdown-item${selected ? ' selected' : ''}`;
    item.innerHTML = `
      <div class="item-checkbox">${selected ? '✓' : ''}</div>
      <div class="item-color" style="background:${color};${selected ? `box-shadow:0 0 5px ${color};` : ''}"></div>
      <div class="item-plate">${v.plate}</div>
      <div class="item-status ${v.status}">${v.status === 'moving' ? '● Movimento' : '◉ Parado'}</div>
    `;

    item.addEventListener('click', () => {
      if (_selected.has(v.plate)) {
        _selected.delete(v.plate);
      } else {
        _selected.add(v.plate);
      }
      const q = document.getElementById('dropdownSearch').value.toLowerCase();
      const filtered = _allVehicles.filter(v => v.plate.toLowerCase().includes(q));
      _renderList(filtered);
      _updateTrigger();
      _onChangeCb && _onChangeCb(getSelectedPlates());
    });

    list.appendChild(item);
  });

  document.getElementById('selectionCount').textContent = `${_selected.size} selecionados`;
}

function _updateTrigger() {
  const tagsEl = document.getElementById('dropdownTags');
  const selected = Array.from(_selected);

  if (selected.length === 0) {
    tagsEl.innerHTML = '<span class="dropdown-placeholder">Selecionar veículos...</span>';
    return;
  }

  const visible = selected.slice(0, 2);
  const rest    = selected.length - visible.length;

  tagsEl.innerHTML = visible.map((plate, i) => {
    const color = PALETTE[i % PALETTE.length];
    return `<span class="vehicle-tag" style="background:${color}22;color:${color};">
      <span class="tag-dot" style="background:${color};"></span>${plate}
    </span>`;
  }).join('') + (rest > 0 ? `<span class="vehicle-tag" style="background:#334155;color:#94a3b8;">+${rest}</span>` : '');

  document.getElementById('selectionCount').textContent = `${_selected.size} selecionados`;
}

function getSelectedPlates() {
  return Array.from(_selected);
}

function selectPlate(plate) {
  _selected.add(plate);
  _renderList(_allVehicles);
  _updateTrigger();
}

function resetDropdown() {
  _selected.clear();
  _renderList(_allVehicles);
  _updateTrigger();
}