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
  const url = `${process.env.SSX_BASE_URL}/Login`;
  const body = {
    Username: process.env.SSX_USER,
    Password: process.env.SSX_PASSWORD,
    HashAuth: process.env.SSX_HASH_AUTH,
    ClientIntegrationCodeBus: process.env.SSX_CLIENT_CODE
  };

  const response = await axios.post(url, body);

  // A API SSX retorna o token no campo "Token" (verificar no primeiro run)
  _token = response.data.Token || response.data.token || response.data.access_token;
  if (!_token) {
    throw new Error(`SSX Login: campo token não encontrado. Resposta: ${JSON.stringify(response.data)}`);
  }

  _fetchedAt = Date.now();
  return _token;
}

function clearToken() {
  _token = null;
  _fetchedAt = null;
}

module.exports = { getToken, clearToken };
