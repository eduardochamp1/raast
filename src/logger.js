'use strict';
/**
 * src/logger.js
 * Logger estruturado usando Pino.
 * - Em desenvolvimento: saída legível via pino-pretty
 * - Em produção:        saída JSON para stdout (pronta para log aggregators)
 */

const pino = require('pino');
const config = require('./config');

const isDev = config.nodeEnv === 'development';

const logger = pino({
  level: config.logLevel,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize:       true,
            translateTime:  'SYS:HH:MM:ss',
            ignore:         'pid,hostname',
          },
        },
      }
    : {
        // Produção: JSON puro, pronto para ingestão por Datadog/Loki/CloudWatch
        formatters: {
          level(label) { return { level: label }; },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

module.exports = logger;
