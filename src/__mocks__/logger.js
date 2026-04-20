'use strict';
// Mock de src/logger.js — silencia todos os logs durante testes
const noop = () => {};
module.exports = {
  trace: noop, debug: noop, info: noop,
  warn:  noop, error: noop, fatal: noop,
};
