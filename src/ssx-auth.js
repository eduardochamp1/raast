'use strict';
const axios  = require('axios');
const config = require('./config');
const logger = require('./logger');

let _token     = null;
let _fetchedAt = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutos

async function getToken() {
  if (_token && _fetchedAt && Date.now() - _fetchedAt < TOKEN_TTL_MS) {
    return _token;
  }
  return _refreshToken();
}

async function _refreshToken() {
  const url  = `${config.ssxBaseUrl}/Login`;
  const body = new URLSearchParams({
    Username: config.ssxUser,
    Password: config.ssxPassword,
    HashAuth: config.ssxHashAuth,
  }).toString();

  const response = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const raw = response.data.AccessToken
           || response.data.Token
           || response.data.token
           || response.data.access_token;

  if (!raw) {
    throw new Error(`SSX Login: campo token não encontrado. Resposta: ${JSON.stringify(response.data)}`);
  }

  _token     = decodeURIComponent(raw);
  _fetchedAt = Date.now();
  logger.debug('[ssx-auth] Token renovado');
  return _token;
}

function clearToken() {
  _token     = null;
  _fetchedAt = null;
}

module.exports = { getToken, clearToken };
