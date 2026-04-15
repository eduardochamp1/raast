const express = require('express');
const router = express.Router();
const { listVehicles, getPositionHistory } = require('../ssx-client');

// Cache simples de 5 minutos para evitar chamadas repetidas
let _vehiclesCache = null;
let _cacheAt = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedVehicles() {
  if (_vehiclesCache && _cacheAt && Date.now() - _cacheAt < CACHE_TTL) {
    return _vehiclesCache;
  }

  const raw = await listVehicles();
  // A API retorna array de objetos — mapear para campos conhecidos
  // NOTA: verificar campo exato no primeiro run logando `raw[0]`
  const vehicles = (Array.isArray(raw) ? raw : []).map(v => ({
    integrationCode: v.IntegrationCode || v.VehicleIntegrationCode || v.Code,
    plate: v.LicensePlate || v.Plate || v.plate,
    description: v.Description || v.Name || ''
  })).filter(v => v.integrationCode && v.plate);

  _vehiclesCache = vehicles;
  _cacheAt = Date.now();
  return vehicles;
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
    const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sinceISO = since.toISOString().slice(0, 19);
    const nowISO = now.toISOString().slice(0, 19);

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
