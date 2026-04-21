// Datas padrão: 1º do mês atual até hoje
function getDefaultDates() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return {
    start: `${y}-${m}-01`,
    end:   `${y}-${m}-${d}`
  };
}

function setLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
  document.getElementById('searchBtn').disabled = on;
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function updateSummary(historyData) {
  let totalPositions = 0, maxSpeed = 0;
  let minDate = null, maxDate = null;

  Object.values(historyData).forEach(({ positions }) => {
    if (!positions) return;
    totalPositions += positions.length;
    positions.forEach(p => {
      if ((p.speed ?? 0) > maxSpeed) maxSpeed = p.speed;
      const d = new Date(p.date);
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });
  });

  document.getElementById('statPositions').textContent = totalPositions.toLocaleString('pt-BR');
  document.getElementById('statMaxSpeed').textContent  = maxSpeed ? `${maxSpeed}` : '—';

  // Distância aproximada (soma das distâncias entre pontos consecutivos)
  let totalKm = 0;
  Object.values(historyData).forEach(({ positions }) => {
    if (!positions || positions.length < 2) return;
    for (let i = 1; i < positions.length; i++) {
      totalKm += _haversine(positions[i-1].lat, positions[i-1].lng, positions[i].lat, positions[i].lng);
    }
  });
  document.getElementById('statDistance').textContent = totalKm > 0 ? Math.round(totalKm).toLocaleString('pt-BR') : '—';

  // Duração
  if (minDate && maxDate) {
    const hours = Math.round((maxDate - minDate) / 3600000);
    document.getElementById('statDuration').textContent = `${hours}h`;
  } else {
    document.getElementById('statDuration').textContent = '—';
  }

  document.getElementById('summarySection').style.display = 'block';
}

function renderHistoryTable(historyData) {
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = '';

  let allPositions = [];
  Object.entries(historyData).forEach(([plate, data]) => {
    if (data.positions) {
      data.positions.forEach(p => {
        allPositions.push({ plate, ...p });
      });
    }
  });

  // Ordem decrescente (mais recente primeiro) no grid
  allPositions.sort((a, b) => new Date(b.date) - new Date(a.date));

  allPositions.forEach(p => {
    const tr = document.createElement('tr');
    
    const isIgnitionOn = p.ignition;
    const ignStatus = isIgnitionOn ? 'ign-on' : 'ign-off';
    const ignIcon   = isIgnitionOn ? '🔑' : '🔌'; // Chave verde/laranja = ligado
    
    tr.innerHTML = `
      <td>
        <div class="icon-col">
          <div class="ign-icon ${ignStatus}" title="${isIgnitionOn ? 'Ligado' : 'Desligado'}">${ignIcon}</div>
        </div>
      </td>
      <td style="font-weight:600;">${p.plate}</td>
      <td>${formatDateTime(p.date)}</td>
      <td>${Math.round(p.speed || 0)} km/h</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('bottomPanel').style.display = 'flex';
}

function _haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

let _liveInterval = null;
let _isLiveMode   = true;

async function fetchLivePositions() {
  if (!_isLiveMode) return;
  try {
    const vehicles = await apiGetVehicles();
    
    // Evita Race Condition: o await acima pode ter demorado e o botão Buscar Histórico foi clicado nesse meio tempo
    if (!_isLiveMode) return; 

    plotVehicles(vehicles, (plate) => selectPlate(plate));
    
    // Se há filtro ativo no dropdown, aplicá-lo nos novos marcadores
    const selected = getSelectedPlates();
    if (selected.length > 0) dimVehicleMarkers(selected);
    
  } catch (err) {
    console.error('Erro ao atualizar posições ao vivo:', err);
  }
}

function startLiveMode() {
  _isLiveMode = true;
  fetchLivePositions(); // Executa a primeira logo de cara
  if (!_liveInterval) {
    _liveInterval = setInterval(fetchLivePositions, 15000); // 15 segundos
  }
}

function stopLiveMode() {
  _isLiveMode = false;
  if (_liveInterval) {
    clearInterval(_liveInterval);
    _liveInterval = null;
  }
}

async function main() {
  // Inicializar mapa
  initMap();

  // Definir datas padrão
  const { start, end } = getDefaultDates();
  document.getElementById('startDate').value = start;
  document.getElementById('endDate').value   = end;

  // Carregar lista de veículos para o dropdown
  let vehicleList = [];
  try {
    vehicleList = await apiGetVehicleList();
  } catch (err) {
    showError('Não foi possível carregar a lista de veículos.');
    console.error(err);
  }

  // Inicializar dropdown com callback para atualizar visibilidade imediata
  initDropdown(vehicleList, (selectedPlates) => {
    // Só aplicar filtro onfly no Live Mode. No History Mode ele recalcula as cores na busca
    if (_isLiveMode) {
      if (selectedPlates.length === 0) restoreVehicleMarkers();
      else dimVehicleMarkers(selectedPlates);
    }
  });

  // Inicia o tracking em tempo real por padrão
  startLiveMode();

  // Botão Buscar
  document.getElementById('searchBtn').addEventListener('click', async () => {
    hideError();
    document.getElementById('bottomPanel').style.display = 'none';
    const plates  = getSelectedPlates();
    const start   = document.getElementById('startDate').value;
    const end     = document.getElementById('endDate').value;
    const timeFrom = document.getElementById('timeFrom').value;
    const timeTo   = document.getElementById('timeTo').value;

    if (plates.length === 0) { showError('Selecione ao menos um veículo.'); return; }
    if (!start || !end)       { showError('Informe o período de busca.'); return; }
    if (new Date(start) > new Date(end)) { showError('Data de início deve ser anterior à data de fim.'); return; }

    setLoading(true);
    stopLiveMode(); // Pausa atualização 15s
    clearVehicleMarkers(); // Oculta live tracking
    
    try {
      const historyData = await apiGetHistory({ plates, start, end, timeFrom, timeTo });

      // Verificar se algum veículo retornou dados
      const hasData = Object.values(historyData).some(v => v.positions && v.positions.length > 0);
      if (!hasData) {
        showError('Nenhuma posição encontrada para o período selecionado.');
        setLoading(false);
        return;
      }

      // Mapa de cores: plate → cor
      const colorMap = {};
      plates.forEach((p, i) => { colorMap[p] = PALETTE[i % PALETTE.length]; });

      plotRoutes(historyData, colorMap);
      dimVehicleMarkers(plates);
      updateSummary(historyData);
      renderHistoryTable(historyData);
    } catch (err) {
      showError(`Erro na busca: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  });

  // Botão Limpar
  document.getElementById('clearBtn').addEventListener('click', () => {
    hideError();
    clearRoutes();
    resetDropdown();
    
    document.getElementById('bottomPanel').style.display = 'none';
    
    // Retoma modo Ao Vivo
    startLiveMode();
    document.getElementById('summarySection').style.display = 'none';
    const { start, end } = getDefaultDates();
    document.getElementById('startDate').value = start;
    document.getElementById('endDate').value   = end;
    document.getElementById('timeFrom').value = '00:00';
    document.getElementById('timeTo').value   = '23:59';
  });

  document.getElementById('closeBottomPanel').addEventListener('click', () => {
    document.getElementById('bottomPanel').style.display = 'none';
  });
}

// NOTA: PALETTE é definida em map.js (carregado antes) — não redeclarar aqui

main().catch(console.error);