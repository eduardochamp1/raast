require('dotenv').config();
const axios = require('axios');
const { getToken, clearToken } = require('./ssx-auth');

// ── Rate-limit retry ──────────────────────────────────────────────────────────
// Maximum number of times to retry a 429 response before giving up.
const MAX_RETRIES = 4;

// Base delay (ms) for exponential back-off: 2 s → 4 s → 8 s → 16 s
const RETRY_BASE_MS = 2000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function ssx(path, body) {
  const token = await getToken();

  const makeRequest = async (authToken) => {
    try {
      const response = await axios.post(
        `${process.env.SSX_BASE_URL}${path}`,
        body,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` } }
      );
      return response.data;
    } catch (err) {
      // Logar detalhes completos para debug (status + corpo da resposta SSX)
      if (err.response) {
        console.error(`[SSX] ${path} → HTTP ${err.response.status}`, JSON.stringify(err.response.data));
      }
      const wrapped = err instanceof Error ? err : Object.assign(new Error('SSX request failed'), err);
      throw wrapped;
    }
  };

  // First attempt (with 401 token-refresh fallback, unchanged)
  let lastErr;
  let currentToken = token;
  try {
    return await makeRequest(currentToken);
  } catch (err) {
    if (err.response && err.response.status === 401) {
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

  // Retry loop — only for 429 (rate limited)
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (!lastErr?.response || lastErr.response.status !== 429) throw lastErr;

    // Honour Retry-After header when present (value in seconds)
    const retryAfterSec = Number(lastErr.response.headers?.['retry-after']);
    const delayMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? retryAfterSec * 1000
      : RETRY_BASE_MS * Math.pow(2, attempt - 1); // 2 s, 4 s, 8 s, 16 s

    console.warn(`[SSX] 429 rate-limited — waiting ${Math.round(delayMs / 1000)}s before retry ${attempt}/${MAX_RETRIES}`);
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
  // Endpoint que retorna última posição de todos os veículos do cliente
  // Body: { ClientIntegrationCode: "18" } — retorna array com TrackedUnitIntegrationCode, TrackedUnit, Lat, Lng, etc.
  return ssx('/Controlws/LastPosition/GetLastPositions', {
    ClientIntegrationCode: process.env.SSX_CLIENT_CODE
  });
}

async function getPositionHistory(conditions) {
  return ssx('/v3/Tracking/PositionHistory/List', conditions);
}

module.exports = { ssx, getLastPositions, getPositionHistory };
