const express = require('express');
const router = express.Router();
const { fetchAllPositions } = require('../pagination');
const { listVehicles } = require('../ssx-client');

// GET /api/history?plates=ABC-1234,DEF-5678&start=2026-01-01&end=2026-01-31&timeFrom=00:00&timeTo=23:59
router.get('/', async (req, res) => {
  const { plates, start, end, timeFrom = '00:00', timeTo = '23:59' } = req.query;

  if (!plates || !start || !end) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: plates, start, end' });
  }

  const plateList = plates.split(',').map(p => p.trim()).filter(Boolean);
  if (plateList.length === 0) {
    return res.status(400).json({ error: 'Informe ao menos uma placa' });
  }

  try {
    // Buscar mapeamento placa → integrationCode
    const allVehicles = await (async () => {
      const raw = await listVehicles();
      return (Array.isArray(raw) ? raw : []).map(v => ({
        integrationCode: v.IntegrationCode || v.VehicleIntegrationCode || v.Code,
        plate: v.LicensePlate || v.Plate || v.plate
      }));
    })();

    const startISO = `${start}T${timeFrom}:00`;
    const endISO   = `${end}T${timeTo}:00`;

    // Buscar histórico de todos os veículos em paralelo
    const fetchPromises = plateList.map(async (plate) => {
      const vehicle = allVehicles.find(v =>
        v.plate && v.plate.toUpperCase() === plate.toUpperCase()
      );

      if (!vehicle) return { plate, positions: [], error: 'Veículo não encontrado' };

      const raw = await fetchAllPositions(vehicle.integrationCode, startISO, endISO);

      // Filtrar por horário do dia se necessário
      const [fromH, fromM] = timeFrom.split(':').map(Number);
      const [toH, toM]     = timeTo.split(':').map(Number);
      const fromMinutes = fromH * 60 + fromM;
      const toMinutes   = toH * 60 + toM;
      const needsTimeFilter = !(timeFrom === '00:00' && timeTo === '23:59');

      const positions = raw
        .filter(p => {
          if (!needsTimeFilter) return true;
          const d = new Date(p.PositionDate);
          const mins = d.getHours() * 60 + d.getMinutes();
          return mins >= fromMinutes && mins <= toMinutes;
        })
        .map(p => ({
          lat: p.Latitude,
          lng: p.Longitude,
          date: p.PositionDate,
          speed: p.Speed ?? 0,
          course: p.Course ?? 0
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      return { plate, positions };
    });

    const results = await Promise.allSettled(fetchPromises);

    const response = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        response[r.value.plate] = {
          positions: r.value.positions,
          error: r.value.error || null
        };
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Erro no histórico:', err.message);
    res.status(500).json({ error: 'Falha ao buscar histórico' });
  }
});

module.exports = router;
