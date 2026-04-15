const { fetchAllPositions } = require('./pagination');

function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pad(n) { return String(n).padStart(2, '0'); }

function toLocalISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
       + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildOvernightWindow(dateStr, from, to) {
  const [fromH, fromM] = from.split(':').map(Number);
  const [toH,   toM  ] = to.split(':').map(Number);
  const windowStart = new Date(`${dateStr}T${from}:00`);
  const windowEnd   = new Date(`${dateStr}T${to}:00`);
  // If from >= to the window crosses midnight — advance end by 1 day
  if (fromH > toH || (fromH === toH && fromM >= toM)) {
    windowEnd.setDate(windowEnd.getDate() + 1);
  }
  return { windowStart, windowEnd };
}

async function analyzeVehicleNight(integrationCode, dateStr, bases, config) {
  const { windowStart, windowEnd } = buildOvernightWindow(dateStr, config.from, config.to);
  const positions = await fetchAllPositions(
    integrationCode, toLocalISO(windowStart), toLocalISO(windowEnd)
  );

  if (!positions || positions.length === 0) {
    return { situacao: 'sem_dados', base: null, lat: null, lng: null };
  }

  const sorted = [...positions].sort(
    (a, b) => new Date(a.PositionDate) - new Date(b.PositionDate)
  );
  const median = sorted[Math.floor(sorted.length / 2)];
  const lat    = median.Latitude;
  const lng    = median.Longitude;

  for (const base of bases) {
    if (haversineKm(lat, lng, base.lat, base.lng) * 1000 <= base.raio) {
      return { situacao: 'base', base: base.nome, lat, lng };
    }
  }

  return { situacao: 'fora', base: null, lat, lng };
}

module.exports = { analyzeVehicleNight, haversineKm, buildOvernightWindow };
