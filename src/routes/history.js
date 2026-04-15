const express = require('express');
const router = express.Router();
const { fetchAllPositions } = require('../pagination');
const { getCachedVehicles } = require('./vehicles');

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

  const timeFormatRe = /^\d{2}:\d{2}$/;
  if (!timeFormatRe.test(timeFrom) || !timeFormatRe.test(timeTo)) {
    return res.status(400).json({ error: 'Formato inválido para timeFrom/timeTo. Use HH:MM' });
  }
  const [fromH, fromM] = timeFrom.split(':').map(Number);
  const [toH, toM]     = timeTo.split(':').map(Number);
  const fromMinutes = fromH * 60 + fromM;
  const toMinutes   = toH * 60 + toM;
  const needsTimeFilter = !(timeFrom === '00:00' && timeTo === '23:59');

  try {
    // Reutilizar cache compartilhado de vehicles.js (evita chamada extra à SSX)
    const allVehicles = await getCachedVehicles();

    const startISO = `${start}T${timeFrom}:00`;
    const endISO   = `${end}T${timeTo}:00`;

    // Buscar histórico de todos os veículos em paralelo
    const fetchPromises = plateList.map(async (plate) => {
      const vehicle = allVehicles.find(v =>
        v.plate && v.plate.toUpperCase() === plate.toUpperCase()
      );

      if (!vehicle) return { plate, positions: [], error: 'Veículo não encontrado' };

      const raw = await fetchAllPositions(vehicle.integrationCode, startISO, endISO);

      const positions = raw
        .filter(p => {
          if (p.Latitude == null || p.Longitude == null) return false;
          if (!needsTimeFilter) return true;
          const timePart = p.PositionDate ? p.PositionDate.slice(11, 16) : '00:00';
          const [h, m] = timePart.split(':').map(Number);
          const mins = h * 60 + m;
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
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const plate = plateList[i];
      if (r.status === 'fulfilled') {
        response[plate] = {
          positions: r.value.positions,
          error: r.value.error || null
        };
      } else {
        response[plate] = {
          positions: [],
          error: r.reason?.message || 'Erro ao buscar posições'
        };
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Erro no histórico:', err);
    res.status(500).json({ error: 'Falha ao buscar histórico' });
  }
});

module.exports = router;
