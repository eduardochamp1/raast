require('dotenv').config();
const axios = require('axios');

let _token = null;
let _fetchedAt = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutos

async function getToken() {
  if (_token && _fetchedAt && Date.now() - _fetchedAt < TOKEN_TTL_MS) {
    return _token;
  }
  return _refreshToken();
}

async function _refreshToken() {
  const missing = ['SSX_BASE_URL','SSX_USER','SSX_PASSWORD','SSX_HASH_AUTH','SSX_CLIENT_CODE']
    .filter(k => !process.env[k]);
  if (missing.length) throw new Error(`SSX Auth: env vars faltando: ${missing.join(', ')}`);

  const url = `${process.env.SSX_BASE_URL}/Login`;
  // SSX requer application/x-www-form-urlencoded (não JSON)
  // ClientIntegrationCodeBus NÃO vai no login — causa UnexpectedError
  const body = new URLSearchParams({
    Username: process.env.SSX_USER,
    Password: process.env.SSX_PASSWORD,
    HashAuth: process.env.SSX_HASH_AUTH,
  }).toString();

  const response = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  // SSX retorna "AccessToken" URL-encoded — precisa de decodeURIComponent
  const raw = response.data.AccessToken || response.data.Token || response.data.token || response.data.access_token;
  if (!raw) {
    throw new Error(`SSX Login: campo token não encontrado. Resposta: ${JSON.stringify(response.data)}`);
  }
  _token = decodeURIComponent(raw);

  _fetchedAt = Date.now();
  return _token;
}

function clearToken() {
  _token = null;
  _fetchedAt = null;
}

module.exports = { getToken, clearToken };
