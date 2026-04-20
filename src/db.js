'use strict';
/**
 * src/db.js
 * Banco de dados SQLite via better-sqlite3.
 * - Cria as tabelas na primeira execução (CREATE TABLE IF NOT EXISTS)
 * - Migra automaticamente dados dos arquivos JSON existentes em data/
 * - Exporta instância singleton
 */

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');
const config  = require('./config');
const logger  = require('./logger');

// ── Caminho do banco ──────────────────────────────────────────────────────────
const DATA_DIR = config.dataDir || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'raast.db');

// ── Abrir banco ───────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

// PRAGMAs de performance e segurança
db.pragma('journal_mode = WAL');       // leituras simultâneas sem bloqueio
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');     // bom equilíbrio entre durabilidade e velocidade
db.pragma('cache_size = -32000');      // 32 MB de cache em memória

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS bases (
    id    TEXT PRIMARY KEY,
    nome  TEXT NOT NULL,
    lat   REAL NOT NULL,
    lng   REAL NOT NULL,
    raio  REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS grupos (
    id   TEXT PRIMARY KEY,
    nome TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS grupo_placas (
    grupo_id TEXT NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
    placa    TEXT NOT NULL,
    PRIMARY KEY (grupo_id, placa)
  );

  CREATE TABLE IF NOT EXISTS overnight_config (
    id   INTEGER PRIMARY KEY CHECK (id = 1),  -- apenas 1 linha
    from_time TEXT NOT NULL DEFAULT '22:00',
    to_time   TEXT NOT NULL DEFAULT '06:00'
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id       TEXT PRIMARY KEY,
    data     TEXT NOT NULL,
    placa    TEXT NOT NULL,
    grupo    TEXT NOT NULL,
    lat      REAL,
    lng      REAL,
    visto    INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_visto    ON alerts(visto);
  CREATE INDEX IF NOT EXISTS idx_alerts_placa_data ON alerts(placa, data);
  CREATE INDEX IF NOT EXISTS idx_grupo_placas_grupo ON grupo_placas(grupo_id);

  CREATE TABLE IF NOT EXISTS overnight_results (
    placa      TEXT NOT NULL,
    data       TEXT NOT NULL,
    situacao   TEXT NOT NULL,
    base_nome  TEXT,
    lat        REAL,
    lng        REAL,
    criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (placa, data)
  );
`);

// ── Seed da config de pernoite (se ainda não existe) ─────────────────────────
const hasConfig = db.prepare('SELECT 1 FROM overnight_config WHERE id = 1').get();
if (!hasConfig) {
  db.prepare('INSERT INTO overnight_config (id, from_time, to_time) VALUES (1, ?, ?)')
    .run('22:00', '06:00');
}

// ── Migração automática a partir dos JSONs existentes ────────────────────────
function migrateFromJSON(filename, migratorFn) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    migratorFn(data);
    // Renomear para não migrar novamente
    fs.renameSync(filePath, filePath + '.migrated');
    logger.info(`[db] Migração de ${filename} concluída`);
  } catch (err) {
    logger.warn({ err }, `[db] Falha ao migrar ${filename} — será ignorado`);
  }
}

migrateFromJSON('bases.json', (bases) => {
  if (!Array.isArray(bases) || bases.length === 0) return;
  const existing = new Set(db.prepare('SELECT id FROM bases').all().map(r => r.id));
  const ins = db.prepare('INSERT OR IGNORE INTO bases (id, nome, lat, lng, raio) VALUES (?, ?, ?, ?, ?)');
  const txn = db.transaction((rows) => rows.forEach(b => {
    if (!existing.has(b.id)) ins.run(b.id, b.nome, b.lat, b.lng, b.raio);
  }));
  txn(bases);
});

migrateFromJSON('groups.json', (groups) => {
  if (!Array.isArray(groups) || groups.length === 0) return;
  const insGrp = db.prepare('INSERT OR IGNORE INTO grupos (id, nome) VALUES (?, ?)');
  const insPlc = db.prepare('INSERT OR IGNORE INTO grupo_placas (grupo_id, placa) VALUES (?, ?)');
  const txn = db.transaction((rows) => {
    rows.forEach(g => {
      insGrp.run(g.id, g.nome);
      (g.placas || []).forEach(p => insPlc.run(g.id, p));
    });
  });
  txn(groups);
});

migrateFromJSON('overnight-config.json', (cfg) => {
  if (!cfg || !cfg.from || !cfg.to) return;
  db.prepare('INSERT OR REPLACE INTO overnight_config (id, from_time, to_time) VALUES (1, ?, ?)')
    .run(cfg.from, cfg.to);
});

migrateFromJSON('alerts.json', (alerts) => {
  if (!Array.isArray(alerts) || alerts.length === 0) return;
  const ins = db.prepare(`
    INSERT OR IGNORE INTO alerts (id, data, placa, grupo, lat, lng, visto)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const txn = db.transaction((rows) => rows.forEach(a =>
    ins.run(a.id, a.data, a.placa, a.grupo || '', a.lat ?? null, a.lng ?? null, a.visto ? 1 : 0)
  ));
  txn(alerts);
});

logger.info(`[db] SQLite pronto: ${DB_PATH}`);

module.exports = db;
