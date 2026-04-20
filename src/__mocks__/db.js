'use strict';
/**
 * src/__mocks__/db.js
 * Mock do src/db.js para testes.
 * Expõe um prepare() configurável por sql e um objeto de controle _stmts.
 */

// ── Shared stmt factory ────────────────────────────────────────────────────────
function makeStmt(getVal, allVal) {
  return {
    run: jest.fn(() => ({ changes: 1 })),
    get: jest.fn(() => getVal),
    all: jest.fn(() => allVal || []),
  };
}

// ── Stmts individuais exportados para configuração nos testes ─────────────────
const _stmts = {
  // bases
  list:         makeStmt(undefined, []),
  get:          makeStmt(undefined),
  insert:       makeStmt(undefined),
  update:       makeStmt(undefined),
  del:          makeStmt(undefined),

  // grupos
  groupList:    makeStmt(undefined, []),
  groupGet:     makeStmt(undefined),
  groupPlacas:  makeStmt(undefined, []),
  groupInsert:  makeStmt(undefined),
  groupUpdate:  makeStmt(undefined),
  groupDel:     makeStmt(undefined),
  groupPlacaDel:makeStmt(undefined),
  groupPlacaIns:makeStmt(undefined),

  // overnight config
  cfgGet:       makeStmt({ from_time: '22:00', to_time: '06:00' }),
  cfgSet:       makeStmt(undefined),

  // alerts
  alertCount:   makeStmt({ n: 0 }),
  alertsUnread: makeStmt(undefined, []),
  alertMarkOne: makeStmt(undefined),
  alertMarkAll: makeStmt(undefined),
  alertDel90:   makeStmt(undefined),
  alertGet:     makeStmt(undefined),
  alertInsert:  makeStmt(undefined),
  alertExists:  makeStmt(undefined),
};

// ── Mock principal: mapeia SQL → stmt ─────────────────────────────────────────
const db = {
  _stmts,
  pragma:      jest.fn(),
  exec:        jest.fn(),
  transaction: jest.fn((fn) => (...args) => fn(...args)),
  prepare:     jest.fn((sql) => {
    // Bases
    if (sql.includes('ORDER BY nome') && sql.includes('bases'))   return _stmts.list;
    if (sql.includes('SELECT * FROM bases WHERE id'))              return _stmts.get;
    if (sql.includes('INSERT INTO bases') || (sql.includes('INSERT') && sql.includes('bases'))) return _stmts.insert;
    if (sql.includes('UPDATE bases'))                              return _stmts.update;
    if (sql.includes('DELETE FROM bases'))                         return _stmts.del;

    // Grupos
    if (sql.includes('SELECT * FROM grupos ORDER'))                return _stmts.groupList;
    if (sql.includes('SELECT * FROM grupos WHERE id'))             return _stmts.groupGet;
    if (sql.includes('SELECT placa FROM grupo_placas'))            return _stmts.groupPlacas;
    if (sql.includes('INSERT') && sql.includes('INTO grupos'))     return _stmts.groupInsert;
    if (sql.includes('UPDATE grupos'))                             return _stmts.groupUpdate;
    if (sql.includes('DELETE FROM grupos'))                        return _stmts.groupDel;
    if (sql.includes('DELETE FROM grupo_placas'))                  return _stmts.groupPlacaDel;
    if (sql.includes('INSERT') && sql.includes('grupo_placas'))    return _stmts.groupPlacaIns;

    // Overnight config
    if (sql.includes('SELECT from_time'))                          return _stmts.cfgGet;
    if (sql.includes('INSERT OR REPLACE INTO overnight_config'))   return _stmts.cfgSet;
    if (sql.includes('SELECT 1 FROM overnight_config'))            return makeStmt(1);

    // Alerts
    if (sql.includes('COUNT(*) AS n FROM alerts'))                 return _stmts.alertCount;
    if (sql.includes('SELECT * FROM alerts WHERE visto = 0'))      return _stmts.alertsUnread;
    if (/UPDATE alerts SET visto = 1 WHERE id/.test(sql))          return _stmts.alertMarkOne;
    if (/UPDATE alerts SET visto = 1\s*$/.test(sql))               return _stmts.alertMarkAll;
    if (sql.includes('DELETE FROM alerts WHERE visto = 1'))        return _stmts.alertDel90;
    if (sql.includes('SELECT * FROM alerts WHERE id'))             return _stmts.alertGet;
    if (sql.includes('INSERT OR IGNORE INTO alerts'))              return _stmts.alertInsert;
    if (sql.includes('SELECT 1 FROM alerts'))                      return _stmts.alertExists;

    // Fallback
    if (sql.includes('SELECT * FROM bases'))                       return _stmts.list;
    if (sql.includes('SELECT * FROM grupos'))                      return _stmts.groupList;

    return makeStmt(undefined, []);
  }),
};

module.exports = db;
