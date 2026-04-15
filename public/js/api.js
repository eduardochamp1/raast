// Wrapper de chamadas ao backend

async function apiGetVehicles() {
  const res = await fetch('/api/vehicles');
  if (!res.ok) throw new Error(`Erro ao buscar veículos: ${res.status}`);
  return res.json();
}

async function apiGetVehicleList() {
  const res = await fetch('/api/vehicles/list');
  if (!res.ok) throw new Error(`Erro ao listar veículos: ${res.status}`);
  return res.json();
}

async function apiGetHistory({ plates, start, end, timeFrom, timeTo }) {
  const params = new URLSearchParams({ plates: plates.join(','), start, end, timeFrom, timeTo });
  const res = await fetch(`/api/history?${params}`);
  if (!res.ok) throw new Error(`Erro ao buscar histórico: ${res.status}`);
  return res.json();
}