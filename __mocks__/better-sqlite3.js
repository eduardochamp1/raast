'use strict';
/**
 * Mock de better-sqlite3 para testes.
 * better-sqlite3 exporta uma CLASSE (Database), então o mock deve ser uma função construtora.
 * Os testes usam jest.mock('better-sqlite3') que automaticamente usa este arquivo.
 *
 * O estado interno é compartilhado e pode ser configurado via Database.__setMockData()
 * e resetado via Database.__resetMockData().
 */

let _mockState = {
  bases:           [],
  groups:          {},       // { id: { id, nome } }
  groupPlacas:     {},       // { grupo_id: ['placa1', 'placa2'] }
  overnightConfig: { from_time: '22:00', to_time: '06:00' },
  alerts:          [],
};

function __setMockData(data) {
  _mockState = { ..._mockState, ...data };
}

function __resetMockData() {
  _mockState = {
    bases:           [],
    groups:          {},
    groupPlacas:     {},
    overnightConfig: { from_time: '22:00', to_time: '06:00' },
    alerts:          [],
  };
}

// ── Cria statement fake baseado no SQL ────────────────────────────────────────
function makeStatement(sql) {
  const s = {
    run: jest.fn(() => ({ changes: 1 })),
    get: jest.fn(() => undefined),
    all: jest.fn(() => []),
  };

  // Bases
  if (/SELECT \* FROM bases ORDER/.test(sql)) {
    s.all.mockImplementation(() => [..._mockState.bases]);
  }
  if (/SELECT \* FROM bases WHERE id/.test(sql)) {
    s.get.mockImplementation((id) => _mockState.bases.find((b) => b.id === id));
  }
  if (/SELECT \* FROM bases$/.test(sql.trim())) {
    s.all.mockImplementation(() => [..._mockState.bases]);
  }
  if (/INSERT INTO bases/.test(sql)) {
    s.run.mockImplementation((id, nome, lat, lng, raio) => {
      _mockState.bases.push({ id, nome, lat, lng, raio });
      return { changes: 1 };
    });
  }
  if (/UPDATE bases SET/.test(sql)) {
    s.run.mockImplementation((nome, lat, lng, raio, id) => {
      const idx = _mockState.bases.findIndex((b) => b.id === id);
      if (idx >= 0) _mockState.bases[idx] = { ..._mockState.bases[idx], nome, lat, lng, raio };
      return { changes: idx >= 0 ? 1 : 0 };
    });
  }
  if (/DELETE FROM bases/.test(sql)) {
    s.run.mockImplementation((id) => {
      const before = _mockState.bases.length;
      _mockState.bases = _mockState.bases.filter((b) => b.id !== id);
      return { changes: before - _mockState.bases.length };
    });
  }

  // Grupos
  if (/SELECT \* FROM grupos ORDER/.test(sql)) {
    s.all.mockImplementation(() => Object.values(_mockState.groups));
  }
  if (/SELECT \* FROM grupos WHERE id/.test(sql)) {
    s.get.mockImplementation((id) => _mockState.groups[id] || undefined);
  }
  if (/SELECT placa FROM grupo_placas WHERE grupo_id/.test(sql)) {
    s.all.mockImplementation((id) => (_mockState.groupPlacas[id] || []).map((p) => ({ placa: p })));
  }
  if (/INSERT OR IGNORE INTO grupos/.test(sql) || /INSERT INTO grupos/.test(sql)) {
    s.run.mockImplementation((id, nome) => {
      _mockState.groups[id] = { id, nome };
      return { changes: 1 };
    });
  }
  if (/UPDATE grupos SET/.test(sql)) {
    s.run.mockImplementation((nome, id) => {
      if (_mockState.groups[id]) _mockState.groups[id].nome = nome;
      return { changes: _mockState.groups[id] ? 1 : 0 };
    });
  }
  if (/DELETE FROM grupos/.test(sql)) {
    s.run.mockImplementation((id) => {
      const had = !!_mockState.groups[id];
      delete _mockState.groups[id];
      delete _mockState.groupPlacas[id];
      return { changes: had ? 1 : 0 };
    });
  }
  if (/DELETE FROM grupo_placas WHERE grupo_id/.test(sql)) {
    s.run.mockImplementation((id) => {
      _mockState.groupPlacas[id] = [];
      return { changes: 1 };
    });
  }
  if (/INSERT OR IGNORE INTO grupo_placas/.test(sql)) {
    s.run.mockImplementation((groupId, placa) => {
      if (!_mockState.groupPlacas[groupId]) _mockState.groupPlacas[groupId] = [];
      if (!_mockState.groupPlacas[groupId].includes(placa)) _mockState.groupPlacas[groupId].push(placa);
      return { changes: 1 };
    });
  }

  // Overnight config
  if (/SELECT from_time, to_time FROM overnight_config/.test(sql)) {
    s.get.mockImplementation(() => ({ ...(_mockState.overnightConfig) }));
  }
  if (/INSERT OR REPLACE INTO overnight_config/.test(sql)) {
    s.run.mockImplementation((from, to) => {
      _mockState.overnightConfig = { from_time: from, to_time: to };
      return { changes: 1 };
    });
  }
  if (/SELECT 1 FROM overnight_config/.test(sql)) {
    s.get.mockImplementation(() => 1);
  }

  // Alerts
  if (/SELECT COUNT\(\*\) AS n FROM alerts WHERE visto = 0/.test(sql)) {
    s.get.mockImplementation(() => ({ n: _mockState.alerts.filter((a) => !a.visto).length }));
  }
  if (/SELECT \* FROM alerts WHERE visto = 0/.test(sql)) {
    s.all.mockImplementation(() => _mockState.alerts.filter((a) => !a.visto));
  }
  if (/UPDATE alerts SET visto = 1 WHERE id/.test(sql)) {
    s.run.mockImplementation((id) => {
      const a = _mockState.alerts.find((x) => x.id === id);
      if (a) a.visto = 1;
      return { changes: a ? 1 : 0 };
    });
  }
  if (/UPDATE alerts SET visto = 1$/.test(sql.trim())) {
    s.run.mockImplementation(() => {
      _mockState.alerts.forEach((a) => { a.visto = 1; });
      return { changes: _mockState.alerts.length };
    });
  }
  if (/SELECT \* FROM alerts WHERE id = \?/.test(sql)) {
    s.get.mockImplementation((id) => _mockState.alerts.find((a) => a.id === id) || undefined);
  }
  if (/INSERT OR IGNORE INTO alerts/.test(sql)) {
    s.run.mockImplementation((id, data, placa, grupo, lat, lng) => {
      _mockState.alerts.push({ id, data, placa, grupo, lat, lng, visto: 0 });
      return { changes: 1 };
    });
  }
  if (/DELETE FROM alerts WHERE visto = 1/.test(sql)) {
    s.run.mockImplementation(() => {
      const c = _mockState.alerts.filter((a) => a.visto).length;
      _mockState.alerts = _mockState.alerts.filter((a) => !a.visto);
      return { changes: c };
    });
  }
  if (/SELECT 1 FROM alerts WHERE placa/.test(sql)) {
    s.get.mockImplementation((placa, data) =>
      _mockState.alerts.find((a) => a.placa === placa && a.data === data) ? 1 : undefined
    );
  }

  return s;
}

// ── Construtor mock ───────────────────────────────────────────────────────────
// better-sqlite3 exporta a CLASSE diretamente:  const Database = require('better-sqlite3')
// então o mock deve ser uma função construtora.
function Database() {
  this.pragma      = jest.fn();
  this.exec        = jest.fn();
  this.prepare     = jest.fn((sql) => makeStatement(sql));
  this.transaction = jest.fn((fn) => (...args) => fn(...args));
}

// Métodos estáticos para controle do estado nos testes
Database.__setMockData    = __setMockData;
Database.__resetMockData  = __resetMockData;

module.exports = Database;
