'use strict';
/**
 * src/config.js
 * Centraliza leitura e validação de variáveis de ambiente.
 * Falha com mensagem clara na startup se alguma var obrigatória faltar.
 */

require('dotenv').config();

const REQUIRED = [
  'SSX_BASE_URL',
  'SSX_USER',
  'SSX_PASSWORD',
  'SSX_HASH_AUTH',
  'SSX_CLIENT_CODE',
];

const missing = REQUIRED.filter((k) => !process.env[k] || process.env[k].trim() === '');
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`[config] ERRO: variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}`);
  // eslint-disable-next-line no-console
  console.error('[config] Copie .env.example para .env e preencha os valores.');
  process.exit(1);
}

const config = {
  ssxBaseUrl:    process.env.SSX_BASE_URL.replace(/\/$/, ''), // sem trailing slash
  ssxUser:       process.env.SSX_USER,
  ssxPassword:   process.env.SSX_PASSWORD,
  ssxHashAuth:   process.env.SSX_HASH_AUTH,
  ssxClientCode: process.env.SSX_CLIENT_CODE,

  port:    Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || null, // null → usa default em data-store.js / db.js

  nodeEnv:  process.env.NODE_ENV || 'production',
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),

  // Rate limiting
  rateLimitWindowMs:  60 * 1000,       // 1 minuto
  rateLimitGeneral:   120,              // 120 req/min por IP (geral)
  rateLimitOvernight: 5,               // 5 req/min por IP no endpoint SSE
};

module.exports = config;
