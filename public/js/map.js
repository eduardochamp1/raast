// Paleta de 10 cores para múltiplos veículos
const PALETTE = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#a78bfa',
  '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6'
];

let _map = null;
let _vehicleMarkers = {};    // marcadores de todos os veículos (plate -> marker)
let _routeLayers = [];       // polylines e marcadores de rota
let _legendControl = null;

function initMap() {
  _map = L.map('map', { zoomControl: true }).setView([-15.8, -47.9], 5);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(_map);

  return _map;
}

function makeVehicleIcon(status, color, lastSeenISO, plate) {
  let isMoving = status === 'moving';
  let bg = isMoving ? '#22c55e' : '#64748b'; // Verde ligado, Cinza desligado
  let icon = '🚛';
  let title = isMoving ? 'Ligado' : 'Desligado';
  
  if (lastSeenISO) {
    const d = new Date(lastSeenISO.endsWith('Z') ? lastSeenISO : lastSeenISO + 'Z');
    const daysDiff = (Date.now() - d.getTime()) / (1000 * 3600 * 24);
    if (daysDiff > 2) {
      bg = '#ef4444'; // Vermelho
      icon = '🛑';
      title = 'Sem Sinal (> 2 dias)';
    }
  }
  let tooltipText = plate ? `${plate} - ${title}` : title;
  
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};border:2px solid #fff;
      box-shadow:0 0 8px ${bg};
      display:flex;align-items:center;justify-content:center;
      font-size:14px;cursor:pointer;" title="${tooltipText}">${icon}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  // Garante que a string seja tratada como UTC (já que a SSX manda UTC sem o 'Z')
  const d = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
  if (isNaN(d.getTime())) return isoString.replace('T', ' ').slice(0, 19);
  
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function plotVehicles(vehicles, onVehicleClick) {
  vehicles.forEach(v => {
    if (!v.lat || !v.lng) return;

    let marker = _vehicleMarkers[v.plate];

    const popupHtml = `
      <div class="popup-plate">${v.plate}</div>
      <div class="popup-row">⚡ Velocidade: <span>${Math.round(v.speed ?? 0)} km/h</span></div>
      <div class="popup-row">🧭 Direção: <span>${Math.round(v.course ?? 0)}°</span></div>
      <div class="popup-row">🕐 Última pos: <span>${formatDateTime(v.lastSeen)}</span></div>
    `;

    if (marker) {
      marker.setLatLng([v.lat, v.lng]);
      marker.setIcon(makeVehicleIcon(v.status, '#3b82f6', v.lastSeen, v.plate));
      if (marker.getPopup() && marker.isPopupOpen()) {
        marker.setPopupContent(popupHtml);
      } else {
        marker.bindPopup(popupHtml);
      }
    } else {
      marker = L.marker([v.lat, v.lng], {
        icon: makeVehicleIcon(v.status, '#3b82f6', v.lastSeen, v.plate)
      });
      marker._plate = v.plate;
      marker.bindPopup(popupHtml);
      marker.on('click', () => onVehicleClick(v.plate));
      marker.addTo(_map);
      _vehicleMarkers[v.plate] = marker;
    }
  });

  // Remove plate markers that disappeared from API
  const incoming = new Set(vehicles.map(v => v.plate));
  Object.keys(_vehicleMarkers).forEach(plate => {
    if (!incoming.has(plate)) {
      _map.removeLayer(_vehicleMarkers[plate]);
      delete _vehicleMarkers[plate];
    }
  });
}

function plotRoutes(historyData, colorMap) {
  clearRoutes();

  const allLatLngs = [];
  const legendItems = [];

  Object.entries(historyData).forEach(([plate, { positions }]) => {
    if (!positions || positions.length === 0) return;

    const color = colorMap[plate] || PALETTE[0];
    const latLngs = positions.map(p => [p.lat, p.lng]);
    allLatLngs.push(...latLngs);

    // Linha da rota Cinza Chumbo
    const polyline = L.polyline(latLngs, { color: '#64748b', weight: 4, opacity: 0.9 }).addTo(_map);
    _routeLayers.push(polyline);

    // Setas indicando deslocamento
    if (window.L && L.polylineDecorator) {
      const arrowDecorator = L.polylineDecorator(polyline, {
        patterns: [
          {
            offset: 40,
            repeat: 100, // repete a cada 100 pixels
            symbol: L.Symbol.arrowHead({
              pixelSize: 12,
              polygon: false,
              pathOptions: { stroke: true, weight: 3, color: '#334155', opacity: 1 }
            })
          }
        ]
      }).addTo(_map);
      _routeLayers.push(arrowDecorator);
    }

    // NÓS DA TRAJETÓRIA (Bolinhas nos vértices do GPS)
    positions.forEach((p, idx) => {
      // Ignora o primeiro e o último (que terão ícones próprios) se desejar, ou desenha em todos
      const dot = L.circleMarker([p.lat, p.lng], {
        radius: 4, color: '#334155', weight: 2, fillColor: '#ffffff', fillOpacity: 1
      }).addTo(_map)
      .bindPopup(`<b>${plate}</b><br>🕐 ${formatDateTime(p.date)}<br>⚡ ${Math.round(p.speed||0)} km/h`);
      _routeLayers.push(dot);
    });

    // PINO PRINCIPAL VERMELHO (Fim/Posição Atual)
    const endIcon = L.divIcon({
      className: '',
      html: `<div style="
        width:32px;height:32px;border-radius:50% 50% 50% 0;
        background:#ef4444;border:2px solid #fff;
        box-shadow:2px 2px 6px rgba(0,0,0,0.5);
        transform: rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
      "><span style="transform: rotate(45deg);font-size:14px;color:#fff">🚚</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });
    const endMarker = L.marker(latLngs[latLngs.length - 1], { icon: endIcon })
      .addTo(_map).bindPopup(`<b>${plate}</b> — Última Posição Visível`);
    _routeLayers.push(endMarker);

    legendItems.push({ plate, color: colorMap[plate] });
  });

  // Zoom para enquadrar todas as rotas
  if (allLatLngs.length > 0) {
    _map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
  }

  // Legenda dinâmica
  _updateLegend(legendItems);
}

function dimVehicleMarkers(selectedPlates) {
  // Configura visibilidade do marcador conforme lista
  const upper = selectedPlates.map(p => p.toUpperCase());
  Object.values(_vehicleMarkers).forEach(m => {
    const isSelected = upper.includes((m._plate || '').toUpperCase());
    if (isSelected && !_map.hasLayer(m)) {
      m.addTo(_map);
    } else if (!isSelected && _map.hasLayer(m)) {
      _map.removeLayer(m);
    }
  });
}

function restoreVehicleMarkers() {
  Object.values(_vehicleMarkers).forEach(m => {
    if (!_map.hasLayer(m)) m.addTo(_map);
  });
}

function clearRoutes() {
  _routeLayers.forEach(l => _map.removeLayer(l));
  _routeLayers = [];
  if (_legendControl) { _map.removeControl(_legendControl); _legendControl = null; }
}

function clearVehicleMarkers() {
  Object.values(_vehicleMarkers).forEach(m => _map.removeLayer(m));
  _vehicleMarkers = {};
}

function _updateLegend(items) {
  if (_legendControl) _map.removeControl(_legendControl);
  if (items.length === 0) return;

  _legendControl = L.control({ position: 'bottomleft' });
  _legendControl.onAdd = () => {
    const div = L.DomUtil.create('div');
    div.style.cssText = 'background:rgba(255,255,255,.95);border:1px solid #cbd5e1;border-radius:8px;padding:10px 14px;font-size:12px;color:#475569;box-shadow:0 2px 8px rgba(0,0,0,.12);';
    div.innerHTML = items.map(i =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="width:20px;height:3px;border-radius:2px;background:${i.color};"></div>
        <span style="color:#1e293b;font-weight:600;">${i.plate}</span>
      </div>`
    ).join('');
    return div;
  };
  _legendControl.addTo(_map);
}

function getColorForVehicle(plate, selectedPlates) {
  const idx = selectedPlates.indexOf(plate);
  return PALETTE[idx % PALETTE.length];
}