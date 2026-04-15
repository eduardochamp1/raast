const express = require('express');
const router = express.Router();
const { listVehicles, getPositionHistory } = require('../ssx-client');

// Formata data em tempo LOCAL sem timezone (ex: "2026-01-01T00:00:00")
// Não usar toISOString() — retorna UTC com 'Z', que diverge do tempo local no Brasil (-3h)
function _toLocalISO(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Cache simples de 5 minutos para evitar chamadas repetidas
let _vehiclesCache = null;
let _cacheAt = null;
let _inflight = null;
const CACHE_TTL = 5 * 60 * 1000;

// Janela de busca para "última posição conhecida" — cobre fins de semana e veículos parados
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

async function getCachedVehicles() {
  if (_vehiclesCache && _cacheAt && Date.now() - _cacheAt < CACHE_TTL) {
    return _vehiclesCache;
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const raw = await listVehicles();
    // A API retorna array de objetos — mapear para campos conhecidos
    // NOTA: verificar campo exato no primeiro run logando `raw[0]`
    const vehicles = (Array.isArray(raw) ? raw : []).map(v => ({
      integrationCode: v.IntegrationCode || v.VehicleIntegrationCode || v.Code,
      plate: v.LicensePlate || v.Plate || v.plate,
      description: v.Description || v.Name || ''
    })).filter(v => v.integrationCode && v.plate);

    if (Array.isArray(raw) && raw.length > 0 && vehicles.length === 0) {
      throw new Error('Vehicle mapping produced zero results — check field name fallbacks. Sample: ' + JSON.stringify(raw[0]));
    }

    _vehiclesCache = vehicles;
    _cacheAt = Date.now();
    return vehicles;
  })().finally(() => { _inflight = null; });

  return _inflight;
}

// GET /api/vehicles/list — lista simples de placas para o dropdown
router.get('/list', async (req, res) => {
  try {
    const vehicles = await getCachedVehicles();
    res.json(vehicles.map(v => ({ plate: v.plate, integrationCode: v.integrationCode })));
  } catch (err) {
    console.error('Erro ao listar veículos:', err.message);
    res.status(500).json({ error: 'Falha ao buscar lista de veículos' });
  }
});

// GET /api/vehicles — todos os veículos com última posição conhecida
router.get('/', async (req, res) => {
  try {
    const vehicles = await getCachedVehicles();

    // Buscar última posição de cada veículo (últimas 48h, 1 resultado)
    const now = new Date();
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const sinceISO = _toLocalISO(since);
    const nowISO = _toLocalISO(now);

    const results = await Promise.allSettled(
      vehicles.map(async (v) => {
        try {
          const positions = await getPositionHistory([
            { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: v.integrationCode },
            { PropertyName: 'PositionDate', Condition: 'GreaterThanOrEqualTo', Value: sinceISO },
            { PropertyName: 'PositionDate', Condition: 'LessThanOrEqualTo', Value: nowISO }
          ]);

          const sorted = (Array.isArray(positions) ? positions : [])
            .sort((a, b) => new Date(b.PositionDate) - new Date(a.PositionDate));

          const latest = sorted[0];
          if (!latest) return null;
          if (latest.Latitude == null || latest.Longitude == null) return null;

          return {
            plate: v.plate,
            integrationCode: v.integrationCode,
            lat: latest.Latitude,
            lng: latest.Longitude,
            speed: latest.Speed ?? 0,
            course: latest.Course ?? 0,
            lastSeen: latest.PositionDate,
            status: (latest.Speed ?? 0) > 5 ? 'moving' : 'stopped'
          };
        } catch {
          return null;
        }
      })
    );

    const withPosition = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    res.json(withPosition);
  } catch (err) {
    console.error('Erro ao buscar posições:', err.message);
    res.status(500).json({ error: 'Falha ao buscar posições dos veículos' });
  }
});

module.exports = router;
module.exports.getCachedVehicles = getCachedVehicles;
