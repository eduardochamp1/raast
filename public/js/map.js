// Paleta de 10 cores para múltiplos veículos
const PALETTE = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#a78bfa',
  '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6'
];

let _map = null;
let _vehicleMarkers = [];   // marcadores de todos os veículos
let _routeLayers = [];       // polylines e marcadores de rota
let _legendControl = null;

function initMap() {
  _map = L.map('map', { zoomControl: true }).setView([-15.8, -47.9], 5);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(_map);

  return _map;
}

function makeVehicleIcon(status, color) {
  const bg = status === 'moving' ? color : '#7c3aed';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};border:2px solid ${bg};
      box-shadow:0 0 8px ${bg};
      display:flex;align-items:center;justify-content:center;
      font-size:14px;cursor:pointer;">🚛</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function plotVehicles(vehicles, onVehicleClick) {
  clearVehicleMarkers();

  vehicles.forEach(v => {
    if (!v.lat || !v.lng) return;

    const marker = L.marker([v.lat, v.lng], {
      icon: makeVehicleIcon(v.status, '#3b82f6')
    });

    const popupHtml = `
      <div class="popup-plate">${v.plate}</div>
      <div class="popup-row">⚡ Velocidade: <span>${v.speed ?? 0} km/h</span></div>
      <div class="popup-row">🧭 Direção: <span>${v.course ?? 0}°</span></div>
      <div class="popup-row">🕐 Última pos: <span>${v.lastSeen ? v.lastSeen.replace('T',' ').slice(0,19) : '—'}</span></div>
    `;

    marker.bindPopup(popupHtml);
    marker.on('click', () => onVehicleClick(v.plate));
    marker.addTo(_map);
    _vehicleMarkers.push(marker);
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

    // Linha da rota
    const polyline = L.polyline(latLngs, { color, weight: 3, opacity: 0.85 }).addTo(_map);
    _routeLayers.push(polyline);

    // Ponto de início (verde)
    const startDot = L.circleMarker(latLngs[0], {
      radius: 7, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2
    }).addTo(_map).bindTooltip(`${plate} — Início`);
    _routeLayers.push(startDot);

    // Ponto de fim (vermelho)
    const endDot = L.circleMarker(latLngs[latLngs.length - 1], {
      radius: 7, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2
    }).addTo(_map).bindTooltip(`${plate} — Fim`);
    _routeLayers.push(endDot);

    legendItems.push({ plate, color });
  });

  // Zoom para enquadrar todas as rotas
  if (allLatLngs.length > 0) {
    _map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
  }

  // Legenda dinâmica
  _updateLegend(legendItems);
}

function dimVehicleMarkers(selectedPlates) {
  _vehicleMarkers.forEach(m => {
    const el = m.getElement();
    if (!el) return;
    el.style.opacity = selectedPlates.length === 0 ? '1' : '0.3';
  });
}

function restoreVehicleMarkers() {
  _vehicleMarkers.forEach(m => {
    const el = m.getElement();
    if (el) el.style.opacity = '1';
  });
}

function clearRoutes() {
  _routeLayers.forEach(l => _map.removeLayer(l));
  _routeLayers = [];
  if (_legendControl) { _map.removeControl(_legendControl); _legendControl = null; }
}

function clearVehicleMarkers() {
  _vehicleMarkers.forEach(m => _map.removeLayer(m));
  _vehicleMarkers = [];
}

function _updateLegend(items) {
  if (_legendControl) _map.removeControl(_legendControl);
  if (items.length === 0) return;

  _legendControl = L.control({ position: 'bottomleft' });
  _legendControl.onAdd = () => {
    const div = L.DomUtil.create('div');
    div.style.cssText = 'background:rgba(15,23,42,.9);border:1px solid #1e293b;border-radius:8px;padding:10px 14px;font-size:12px;color:#94a3b8;';
    div.innerHTML = items.map(i =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="width:20px;height:3px;border-radius:2px;background:${i.color};"></div>
        <span style="color:#e2e8f0;">${i.plate}</span>
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