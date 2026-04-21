'use strict';
const cron   = require('node-cron');
const { randomUUID } = require('crypto');
const db     = require('./db');
const logger = require('./logger');
const { getCachedVehicles }   = require('./routes/vehicles');
const { analyzeVehicleNight } = require('./overnight');

// ── Queries preparadas ────────────────────────────────────────────────────────
const stmts = {
  getBases:       db.prepare('SELECT * FROM bases'),
  getGroups:      db.prepare('SELECT * FROM grupos'),
  getGroupPlacas: db.prepare('SELECT placa FROM grupo_placas WHERE grupo_id = ?'),
  getConfig:      db.prepare('SELECT from_time, to_time FROM overnight_config WHERE id = 1'),
  alertExists:    db.prepare('SELECT 1 FROM alerts WHERE placa = ? AND data = ?'),
  alertInsert:    db.prepare(`
    INSERT OR IGNORE INTO alerts (id, data, placa, grupo, lat, lng, visto)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `),
  cleanOld:       db.prepare("DELETE FROM alerts WHERE visto = 1 AND data < date('now', '-90 days')"),
  getResult:      db.prepare('SELECT * FROM overnight_results WHERE placa = ? AND data = ?'),
  insertResult:   db.prepare(`
    INSERT OR REPLACE INTO overnight_results (placa, data, situacao, base_nome, lat, lng)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
};

function initCron() {
  // ── Análise de pernoite — todos os dias às 07:00 ──────────────────────────
  cron.schedule('0 7 * * *', async () => {
    logger.info('[cron] Iniciando análise de pernoite...');
    try {
      const bases  = stmts.getBases.all();
      const groups = stmts.getGroups.all();
      const cfg    = stmts.getConfig.get();
      const config = { from: cfg.from_time, to: cfg.to_time };

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const y = yesterday.getFullYear();
      const m = String(yesterday.getMonth() + 1).padStart(2, '0');
      const d = String(yesterday.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      const vehicles    = await getCachedVehicles();
      const plateToCode = Object.fromEntries(vehicles.map((v) => [v.plate, v.integrationCode]));

      // Monta todas as tarefas (grupo + placa) para processar em paralelo
      const tasks = [];
      for (const group of groups) {
        const placas = stmts.getGroupPlacas.all(group.id).map((r) => r.placa);
        for (const plate of placas) {
          tasks.push({ plate, group });
        }
      }

      let inserted = 0;

      // Pool de concorrência N=2 (conservador — roda sem usuário esperando)
      // O throttle global em ssx-client.js garante espaçamento entre req HTTP.
      const queue = [...tasks];
      const workers = Array.from({ length: Math.min(2, tasks.length) }, async () => {
        while (queue.length > 0) {
          const { plate, group } = queue.shift();
          const integrationCode = plateToCode[plate];
          if (!integrationCode) continue;

          let situacao, lat = null, lng = null;

          // Verifica cache
          const cached = stmts.getResult.get(plate, dateStr);
          if (cached) {
            situacao = cached.situacao;
            lat = cached.lat;
            lng = cached.lng;
          } else {
            try {
              const result = await analyzeVehicleNight(integrationCode, dateStr, bases, config);
              situacao = result.situacao;
              lat = result.lat;
              lng = result.lng;

              // Salva no cache
              stmts.insertResult.run(
                plate, dateStr, situacao,
                result.base || null, lat || null, lng || null
              );
            } catch (err) {
              logger.error({ err, plate }, '[cron] Erro ao analisar veículo');
              continue; // pula este veículo, sem cache nem alerta
            }
          }

          if (situacao === 'fora' || situacao === 'uso_fds') {
            if (!stmts.alertExists.get(plate, dateStr)) {
              stmts.alertInsert.run(
                randomUUID(), dateStr, plate, group.nome,
                lat ?? null, lng ?? null
              );
              inserted++;
            }
          }
        }
      });

      await Promise.all(workers);

      logger.info({ dateStr, inserted }, '[cron] Análise de pernoite concluída');
    } catch (err) {
      logger.error({ err }, '[cron] Erro geral na análise de pernoite');
    }
  });

  // ── Limpeza de alertas antigos — todos os dias às 03:00 ──────────────────
  cron.schedule('0 3 * * *', () => {
    try {
      const result = stmts.cleanOld.run();
      if (result.changes > 0) {
        logger.info({ deleted: result.changes }, '[cron] Alertas antigos removidos (>90 dias)');
      }
    } catch (err) {
      logger.error({ err }, '[cron] Erro na limpeza de alertas');
    }
  });

  logger.info('[cron] Jobs agendados: pernoite às 07:00, limpeza às 03:00');
}

module.exports = { initCron };
