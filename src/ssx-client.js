'use strict';
const axios  = require('axios');
const config = require('./config');
const logger = require('./logger');
const { getToken, clearToken } = require('./ssx-auth');

// ── Rate-limit global e retry ─────────────────────────────────────────────────
const MAX_RETRIES        = 4;
const RETRY_BASE_MS      = 3000; // 3 s → 6 s → 12 s → 24 s
const GLOBAL_THROTTLE_MS = 1500; // Espaçamento mínimo entre ANY request para a SSX
const GLOBAL_COOLDOWN_MS = 10000; // Pausa forçada de todos requests ao bater em 429

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Fila serial de throttle — garante que requests são disparadas 1 por vez,
// mesmo com múltiplos callers assíncronos concorrentes.
// Cada chamada encadeia no final da fila e espera o delay antes de prosseguir.
// Isso elimina a race condition do padrão "read-then-write" com timestamp.
let throttleChain  = Promise.resolve();
let cooldownUntil  = 0;

async function waitGlobalThrottle() {
  const prev = throttleChain;
  // Encadeia na fila: esta req só dispara após a anterior + seu delay
  throttleChain = prev.then(async () => {
    const extra = cooldownUntil - Date.now();
    if (extra > 0) await sleep(extra);  // aguarda cooldown de 429 se ativo
    await sleep(GLOBAL_THROTTLE_MS);    // espaçamento mínimo entre requests
  });
  await throttleChain;
}


async function ssx(path, body) {
  const token = await getToken();

  const makeRequest = async (authToken) => {
    await waitGlobalThrottle();
    try {
      const response = await axios.post(
        `${config.ssxBaseUrl}${path}`,
        body,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` } }
      );
      return response.data;
    } catch (err) {
      if (err.response) {
        logger.warn(
          { path, status: err.response.status, data: err.response.data },
          '[ssx-client] Erro na chamada SSX'
        );
        if (err.response.status === 429) {
          logger.warn('[ssx-client] Aplicando cooldown global de 10s');
          cooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
        }
      }
      throw err instanceof Error ? err : Object.assign(new Error('SSX request failed'), err);
    }
  };

  // ── Primeira tentativa (com fallback de refresh em 401) ───────────────────
  let lastErr;
  let currentToken = token;
  try {
    return await makeRequest(currentToken);
  } catch (err) {
    if (err.response && err.response.status === 401) {
      logger.info('[ssx-client] 401 — renovando token');
      clearToken();
      currentToken = await getToken();
      try {
        return await makeRequest(currentToken);
      } catch (err2) {
        lastErr = err2;
      }
    } else {
      lastErr = err;
    }
  }

  // ── Retry com back-off exponencial — apenas para 429 ─────────────────────
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (!lastErr?.response || lastErr.response.status !== 429) throw lastErr;

    const retryAfterSec = Number(lastErr.response.headers?.['retry-after']);
    const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec * 1000
      : RETRY_BASE_MS * Math.pow(2, attempt - 1);

    logger.warn(
      { path, attempt, maxRetries: MAX_RETRIES, delaySec: Math.round(delayMs / 1000) },
      '[ssx-client] 429 rate-limited — aguardando antes de retry'
    );
    await sleep(delayMs);

    try {
      return await makeRequest(currentToken);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr;
}

async function getLastPositions() {
  return ssx('/Controlws/LastPosition/GetLastPositions', {
    ClientIntegrationCode: config.ssxClientCode,
  });
}

async function getPositionHistory(conditions) {
  return ssx('/v3/Tracking/PositionHistory/List', conditions);
}

module.exports = { ssx, getLastPositions, getPositionHistory };
