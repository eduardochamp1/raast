const { fetchAllPositions } = require('./pagination');

// Tempo mínimo de parada (Speed=0 contínuo) para qualificar como "pernoite na base"
const MIN_STOP_MS = 30 * 60 * 1000; // 30 minutos em ms

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

// IMPORTANT: All date/time operations here use the server's LOCAL wall-clock time.
// Do NOT mix these helpers with UTC-based operations (Date.toISOString(), 'Z'-suffix strings).
// This is intentional — SSX API expects local time without timezone offset.
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

/**
 * Percorre as posições ordenadas e retorna o intervalo de parada mais longo
 * com duração >= MIN_STOP_MS. Uma "parada" é uma sequência contínua de posições
 * com Speed === 0. Retorna null se nenhuma parada qualificada for encontrada.
 *
 * @param {Array} sorted — posições ordenadas por PositionDate (asc)
 * @returns {{ lat: number, lng: number, durationMs: number } | null}
 */
function findLongestStop(sorted) {
  let best = null;
  let i = 0;

  while (i < sorted.length) {
    if ((sorted[i].Speed ?? 0) !== 0) { i++; continue; }

    // Início de um intervalo de parada
    const stopStart = i;
    while (i < sorted.length && (sorted[i].Speed ?? 0) === 0) i++;
    const stopEnd = i - 1; // inclusive

    const startMs    = new Date(sorted[stopStart].PositionDate).getTime();
    const endMs      = new Date(sorted[stopEnd].PositionDate).getTime();
    const durationMs = endMs - startMs;

    if (durationMs >= MIN_STOP_MS) {
      // Centro = média das coords de todas as posições da parada
      const slice = sorted.slice(stopStart, stopEnd + 1);
      const lat   = slice.reduce((s, p) => s + p.Latitude,  0) / slice.length;
      const lng   = slice.reduce((s, p) => s + p.Longitude, 0) / slice.length;

      // Strict > means first qualifying stop wins ties (chronological tie-break)
      if (!best || durationMs > best.durationMs) {
        best = { lat, lng, durationMs };
      }
    }
  }

  return best;
}

/**
 * Quando o veículo se moveu a noite toda sem paradas qualificadas, retorna
 * o centro da célula de ~200m com maior concentração de pings.
 *
 * @param {Array} sorted — posições ordenadas
 * @returns {{ lat: number, lng: number }}
 */
function mostFrequentPoint(sorted) {
  if (sorted.length === 0) throw new Error('mostFrequentPoint: sorted array must not be empty');
  const GRID = 0.002; // ~200–225 m at BR latitudes (rectilinear in degrees, not metres)
  const cells = {};

  sorted.forEach(p => {
    const key = `${Math.round(p.Latitude / GRID)},${Math.round(p.Longitude / GRID)}`;
    if (!cells[key]) cells[key] = { count: 0, lats: [], lngs: [] };
    cells[key].count++;
    cells[key].lats.push(p.Latitude);
    cells[key].lngs.push(p.Longitude);
  });

  const best = Object.values(cells).sort((a, b) => b.count - a.count)[0];
  return {
    lat: best.lats.reduce((s, v) => s + v, 0) / best.lats.length,
    lng: best.lngs.reduce((s, v) => s + v, 0) / best.lngs.length,
  };
}

async function analyzeVehicleNight(integrationCode, dateStr, bases, config) {
  const targetDate = new Date(`${dateStr}T12:00:00`);
  const dayOfWeek  = targetDate.getDay();
  const isWeekend  = (dayOfWeek === 0 || dayOfWeek === 6); // 0 = Domingo, 6 = Sábado

  let windowStart, windowEnd;
  
  if (isWeekend) {
    windowStart = new Date(`${dateStr}T00:00:00`);
    windowEnd   = new Date(`${dateStr}T23:59:59`);
  } else {
    const w = buildOvernightWindow(dateStr, config.from, config.to);
    windowStart = w.windowStart;
    windowEnd   = w.windowEnd;
  }

  const positions = await fetchAllPositions(
    integrationCode, toLocalISO(windowStart), toLocalISO(windowEnd)
  );

  if (!positions || positions.length === 0) {
    return { situacao: 'sem_dados', base: null, lat: null, lng: null };
  }

  const sorted = [...positions].sort(
    (a, b) => new Date(a.PositionDate) - new Date(b.PositionDate)
  );

  if (isWeekend) {
    let outsidePings = 0;
    let fallbackLat = null, fallbackLng = null;
    
    // Varre todas as posições do FDS. A tolerância é de >= 3 pings fora para evitar GPS spike
    for (const p of sorted) {
      if (p.Latitude == null || p.Longitude == null) continue;
      
      let insideAny = false;
      for (const base of bases) {
        if (haversineKm(p.Latitude, p.Longitude, base.lat, base.lng) * 1000 <= base.raio) {
          insideAny = true;
          break;
        }
      }
      
      if (!insideAny) {
         if (p.Speed > 0) outsidePings += 2; // se está se movendo, peso maior
         else outsidePings += 1;
         
         if (fallbackLat === null) {
           fallbackLat = p.Latitude;
           fallbackLng = p.Longitude;
         }
      }
    }
    
    if (outsidePings >= 3) {
      return { situacao: 'uso_fds', base: null, lat: fallbackLat, lng: fallbackLng };
    } else {
      const stop = findLongestStop(sorted);
      const loc = stop ?? mostFrequentPoint(sorted);
      for (const base of bases) {
         if (haversineKm(loc.lat, loc.lng, base.lat, base.lng) * 1000 <= base.raio) {
            return { situacao: 'base_fds', base: base.nome, lat: loc.lat, lng: loc.lng };
         }
      }
      // Se por algum motivo o ponto mais frequente caiu fora
      return { situacao: 'uso_fds', base: null, lat: loc.lat, lng: loc.lng };
    }
  }

  // ── Lógica original para Dias Úteis (Pernoite) ──
  const stop = findLongestStop(sorted);
  const { lat, lng } = stop ?? mostFrequentPoint(sorted);

  for (const base of bases) {
    if (haversineKm(lat, lng, base.lat, base.lng) * 1000 <= base.raio) {
      return { situacao: 'base', base: base.nome, lat, lng };
    }
  }

  return { situacao: 'fora', base: null, lat, lng };
}

module.exports = {
  analyzeVehicleNight,
  haversineKm,
  buildOvernightWindow,
  findLongestStop,      // exportado para testes unitários
  mostFrequentPoint,    // exportado para testes unitários
};
