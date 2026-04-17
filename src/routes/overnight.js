const express = require('express');
const router  = express.Router();
const { readJSON, writeJSON } = require('../data-store');
const { getCachedVehicles }   = require('./vehicles');
const { analyzeVehicleNight } = require('../overnight');

// ── Helpers ──────────────────────────────────────────────────────────────────
function isValidTime(t) {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// ── Config ──────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json(readJSON('overnight-config.json', { from: '22:00', to: '06:00' }));
});

router.put('/config', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to || !isValidTime(from) || !isValidTime(to))
    return res.status(400).json({ error: 'from e to devem estar no formato HH:MM com valores válidos (00:00–23:59)' });
  writeJSON('overnight-config.json', { from, to });
  res.json({ from, to });
});

// ── Report ────────────────────────────────────────────────────────────────────
// Sequential (1 worker) + fixed throttle avoids cascading 429s that occur when
// multiple concurrent workers all get rate-limited and all retry simultaneously.
// SSX rate-limit appears to allow ~1 token per 3–4 s (each first attempt gets 429
// at 1 s throttle; the 2 s retry always succeeds).  4 s gives a safe buffer so the
// token is always replenished before the next request starts.
const THROTTLE_MS = 4000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MAX_DAYS = 31; // hard ceiling regardless of group size

function localDateStr(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get('/report', async (req, res) => {
  const { groupId, start, end } = req.query;
  if (!groupId || !start || !end)
    return res.status(400).json({ error: 'groupId, start e end são obrigatórios' });

  // ── Validate before opening SSE stream ─────────────────────────────────────
  const groups = readJSON('groups.json', []);
  const group  = groups.find(g => g.id === groupId);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });

  const startDate = new Date(`${start}T12:00:00`);
  const endDate   = new Date(`${end}T12:00:00`);
  if (isNaN(startDate) || isNaN(endDate))
    return res.status(400).json({ error: 'Datas inválidas. Use o formato YYYY-MM-DD.' });

  const daysDiff = Math.round((endDate - startDate) / 86400000);
  if (daysDiff < 0 || daysDiff >= MAX_DAYS)
    return res.status(400).json({ error: `Período máximo é ${MAX_DAYS} dias.` });

  // ── Switch to SSE ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const bases       = readJSON('bases.json', []);
    const config      = readJSON('overnight-config.json', { from: '22:00', to: '06:00' });
    const vehicles    = await getCachedVehicles();
    const plateToCode = Object.fromEntries(vehicles.map(v => [v.plate, v.integrationCode]));

    // Build flat task list: one entry per (vehicle × day)
    const tasks = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = localDateStr(d);
      for (const plate of group.placas) tasks.push({ plate, dateStr });
    }

    const total = tasks.length;
    let done    = 0;

    // Estimated time: THROTTLE_MS + avg SSX latency (~500 ms) per request
    const estSec = Math.round(total * (THROTTLE_MS + 500) / 1000);
    send({ type: 'start', total, estSec });

    // ── Sequential loop — avoids cascading 429 retries from concurrent workers ──
    let first = true;
    for (const { plate, dateStr } of tasks) {
      if (!first) await sleep(THROTTLE_MS);
      first = false;

      const integrationCode = plateToCode[plate];
      let row;
      if (!integrationCode) {
        row = { placa: plate, data: dateStr, situacao: 'sem_dados', base: null, lat: null, lng: null };
      } else {
        try {
          const analysis = await analyzeVehicleNight(integrationCode, dateStr, bases, config);
          row = { placa: plate, data: dateStr, ...analysis };
        } catch (err) {
          console.error(`[overnight report] ${plate} ${dateStr}:`, err.message);
          row = { placa: plate, data: dateStr, situacao: 'erro', base: null, lat: null, lng: null };
        }
      }
      done++;
      send({ type: 'result', done, total, row });
    }

    send({ type: 'done', total });
  } catch (err) {
    console.error('[overnight report] unexpected error:', err.message);
    send({ type: 'error', message: 'Erro interno ao gerar relatório' });
  }

  res.end();
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
