const express = require('express');
const router  = express.Router();
const { readJSON, writeJSON } = require('../data-store');
const { getCachedVehicles }   = require('./vehicles');
const { analyzeVehicleNight } = require('../overnight');

// ── Config ──────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json(readJSON('overnight-config.json', { from: '22:00', to: '06:00' }));
});

router.put('/config', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from e to são obrigatórios' });
  writeJSON('overnight-config.json', { from, to });
  res.json({ from, to });
});

// ── Report ────────────────────────────────────────────────────────────────────
router.get('/report', async (req, res) => {
  const { groupId, start, end } = req.query;
  if (!groupId || !start || !end)
    return res.status(400).json({ error: 'groupId, start e end são obrigatórios' });

  const groups = readJSON('groups.json', []);
  const group  = groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });

  const bases    = readJSON('bases.json', []);
  const config   = readJSON('overnight-config.json', { from: '22:00', to: '06:00' });
  const vehicles = await getCachedVehicles();
  const plateToCode = Object.fromEntries(vehicles.map(v => [v.plate, v.integrationCode]));

  const results   = [];
  const startDate = new Date(start);
  const endDate   = new Date(end);

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    for (const plate of group.placas) {
      const integrationCode = plateToCode[plate];
      if (!integrationCode) {
        results.push({ placa: plate, data: dateStr, situacao: 'sem_dados', base: null, lat: null, lng: null });
        continue;
      }
      try {
        const analysis = await analyzeVehicleNight(integrationCode, dateStr, bases, config);
        results.push({ placa: plate, data: dateStr, ...analysis });
      } catch (err) {
        console.error(`[overnight report] ${plate} ${dateStr}:`, err.message);
        results.push({ placa: plate, data: dateStr, situacao: 'erro', base: null, lat: null, lng: null });
      }
    }
  }

  res.json(results);
});

// ── Alerts — fixed routes BEFORE /:id/visto ───────────────────────────────────
router.get('/alerts/count', (req, res) => {
  const alerts = readJSON('alerts.json', []);
  res.json({ count: alerts.filter(a => !a.visto).length });
});

router.patch('/alerts/visto-todos', (req, res) => {
  const alerts  = readJSON('alerts.json', []);
  const updated = alerts.map(a => ({ ...a, visto: true }));
  writeJSON('alerts.json', updated);
  res.json({ ok: true });
});

router.get('/alerts', (req, res) => {
  const alerts = readJSON('alerts.json', []);
  res.json(alerts.filter(a => !a.visto));
});

router.patch('/alerts/:id/visto', (req, res) => {
  const alerts = readJSON('alerts.json', []);
  const idx    = alerts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Alerta não encontrado' });
  alerts[idx].visto = true;
  writeJSON('alerts.json', alerts);
  res.json(alerts[idx]);
});

module.exports = router;
