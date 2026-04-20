'use strict';
const express = require('express');
const router  = express.Router();
const { randomUUID }  = require('crypto');
const db               = require('../db');
const logger           = require('../logger');
const { validate }     = require('../middleware/validate');
const { OvernightConfigSchema, OvernightReportQuerySchema } = require('../schemas');
const { getCachedVehicles }   = require('./vehicles');
const { analyzeVehicleNight } = require('../overnight');

// ── Queries preparadas ────────────────────────────────────────────────────────
const stmts = {
  getConfig:      db.prepare('SELECT from_time, to_time FROM overnight_config WHERE id = 1'),
  setConfig:      db.prepare('INSERT OR REPLACE INTO overnight_config (id, from_time, to_time) VALUES (1, ?, ?)'),
  alertCount:     db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE visto = 0'),
  alertsUnread:   db.prepare('SELECT * FROM alerts WHERE visto = 0 ORDER BY data DESC, placa'),
  alertMarkOne:   db.prepare('UPDATE alerts SET visto = 1 WHERE id = ?'),
  alertMarkAll:   db.prepare('UPDATE alerts SET visto = 1'),
  alertDelete90:  db.prepare("DELETE FROM alerts WHERE visto = 1 AND data < date('now', '-90 days')"),
  alertGet:       db.prepare('SELECT * FROM alerts WHERE id = ?'),
  alertInsert:    db.prepare(`
    INSERT OR IGNORE INTO alerts (id, data, placa, grupo, lat, lng, visto)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `),
  alertExists:    db.prepare('SELECT 1 FROM alerts WHERE placa = ? AND data = ?'),
  getBases:       db.prepare('SELECT * FROM bases'),
  getGroups:      db.prepare('SELECT * FROM grupos'),
  getGroupPlacas: db.prepare('SELECT placa FROM grupo_placas WHERE grupo_id = ?'),
  getGroupById:   db.prepare('SELECT * FROM grupos WHERE id = ?'),
  getResult:      db.prepare('SELECT * FROM overnight_results WHERE placa = ? AND data = ?'),
  insertResult:   db.prepare(`
    INSERT OR REPLACE INTO overnight_results (placa, data, situacao, base_nome, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  deleteResultCache: db.prepare('DELETE FROM overnight_results WHERE placa = ? AND data = ?'),
};
// ── Config ────────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const cfg = stmts.getConfig.get();
  res.json({ from: cfg.from_time, to: cfg.to_time });
});

router.put('/config', validate(OvernightConfigSchema), (req, res) => {
  const { from, to } = req.body;
  stmts.setConfig.run(from, to);
  logger.info({ from, to }, '[overnight] Config atualizada');
  res.json({ from, to });
});

// ── Report (SSE) ──────────────────────────────────────────────────────────────
const THROTTLE_MS = 4000;
const MAX_DAYS    = 31;
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get('/report', validate(OvernightReportQuerySchema, 'query'), async (req, res) => {
  const { groupId, start, end } = req.query;

  const group = stmts.getGroupById.get(groupId);
  if (!group) return res.status(404).json({ error: 'Grupo não encontrado' });

  const startDate = new Date(`${start}T12:00:00`);
  const endDate   = new Date(`${end}T12:00:00`);
  const daysDiff  = Math.round((endDate - startDate) / 86400000);
  if (daysDiff >= MAX_DAYS)
    return res.status(400).json({ error: `Período máximo é ${MAX_DAYS} dias.` });

  // Switch para SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush(); // força saída pelo middleware compression
  };

  try {
    const bases       = stmts.getBases.all();
    const cfg         = stmts.getConfig.get();
    const config      = { from: cfg.from_time, to: cfg.to_time };
    const vehicles    = await getCachedVehicles();
    const plateToCode = Object.fromEntries(vehicles.map((v) => [v.plate, v.integrationCode]));
    const placas      = stmts.getGroupPlacas.all(groupId).map((r) => r.placa);

    const allTasks = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = localDateStr(new Date(d));
      for (const plate of placas) allTasks.push({ plate, dateStr });
    }

    const total = allTasks.length;

    // Separar em cache (disponível instantaneamente) vs para buscar (necessita API SSX)
    const cachedItems = [];
    const tasksToFetch = [];
    
    for (const task of allTasks) {
      const cached = stmts.getResult.get(task.plate, task.dateStr);
      if (cached) {
        cachedItems.push({
          placa: cached.placa, data: cached.data, situacao: cached.situacao,
          base: cached.base_nome, lat: cached.lat, lng: cached.lng, cached: true
        });
      } else {
        tasksToFetch.push(task);
      }
    }

    let currentDelay = 2000; // Backoff adaptativo inicial (2s)
    let done = 0;
    
    // Calcula estimativa mais precisa
    const estSec = Math.round((tasksToFetch.length * (currentDelay + 500)) / 1000);
    send({ type: 'start', total, cached: cachedItems.length, toFetch: tasksToFetch.length, estSec });

    // 1. Enviar resultados cacheados imediatamente
    for (const row of cachedItems) {
      done++;
      send({ type: 'result', done, total, row });
    }

    // 2. Fila serial com backoff adaptativo para itens sem cache
    let first = true;
    for (const { plate, dateStr } of tasksToFetch) {
      if (!first) await sleep(currentDelay);
      first = false;

      const integrationCode = plateToCode[plate];
      let row;
      
      if (!integrationCode) {
        row = { placa: plate, data: dateStr, situacao: 'sem_dados', base: null, lat: null, lng: null };
      } else {
        try {
          const analysis = await analyzeVehicleNight(integrationCode, dateStr, bases, config);
          row = { placa: plate, data: dateStr, ...analysis };
          
          // Sucesso → Salva no cache & acelera ligeiramente a fila
          stmts.insertResult.run(
            plate, dateStr, row.situacao,
            row.base || null, row.lat || null, row.lng || null
          );
          currentDelay = Math.max(currentDelay * 0.85, 1000); // min 1s
          
        } catch (err) {
          logger.error({ err, plate, dateStr }, '[overnight report] Erro ao analisar veículo');
          row = { placa: plate, data: dateStr, situacao: 'erro', base: null, lat: null, lng: null };
          
          // Falha → Backoff pesado
          currentDelay = Math.min(currentDelay * 2, 15000); // max 15s
        }
      }
      done++;
      send({ type: 'result', done, total, row });
    }

    send({ type: 'done', total });
  } catch (err) {
    logger.error({ err }, '[overnight report] Erro inesperado');
    send({ type: 'error', message: 'Erro interno ao gerar relatório' });
  }

  res.end();
});

// Cache endpoint para invalidar iten(s) caso seja necessário re-processar
router.delete('/results/cache', (req, res) => {
  const { placa, data } = req.query;
  if (!placa || !data) return res.status(400).json({ error: 'Parâmetros placa e data são obrigatórios' });
  const result = stmts.deleteResultCache.run(placa, data);
  res.json({ deleted: result.changes > 0 });
});

// ── Alerts — rotas fixas ANTES de /:id/visto ──────────────────────────────────
router.get('/alerts/count', (req, res) => {
  const { n } = stmts.alertCount.get();
  res.json({ count: n });
});

router.patch('/alerts/visto-todos', (req, res) => {
  stmts.alertMarkAll.run();
  logger.info('[overnight] Todos alertas marcados como vistos');
  res.json({ ok: true });
});

// DELETE alertas vistos há mais de 90 dias
router.delete('/alerts/antigas', (req, res) => {
  const result = stmts.alertDelete90.run();
  logger.info({ changes: result.changes }, '[overnight] Alertas antigos removidos');
  res.json({ deleted: result.changes });
});

router.get('/alerts', (req, res) => {
  res.json(stmts.alertsUnread.all());
});

router.patch('/alerts/:id/visto', (req, res) => {
  const alert = stmts.alertGet.get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alerta não encontrado' });
  stmts.alertMarkOne.run(req.params.id);
  res.json({ ...alert, visto: 1 });
});

module.exports = router;
module.exports._stmts = stmts; // exportado para uso no cron
