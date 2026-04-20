'use strict';
// Mock de src/config.js para testes
// Provê todas as variáveis com valores de teste
module.exports = {
  ssxBaseUrl:    'http://mock-ssx.test',
  ssxUser:       'test@test.com',
  ssxPassword:   'test-pass',
  ssxHashAuth:   'test-hash',
  ssxClientCode: '99',
  port:           3000,
  dataDir:        null,
  nodeEnv:        'test',
  logLevel:       'silent',
  rateLimitWindowMs:  60000,
  rateLimitGeneral:   1000,
  rateLimitOvernight: 100,
};
