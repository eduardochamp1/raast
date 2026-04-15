require('dotenv').config();
const axios = require('axios');
const { getToken, clearToken } = require('./ssx-auth');

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

  try {
    return await makeRequest(token);
  } catch (err) {
    if (err.response && err.response.status === 401) {
      // Token expirado: renovar e tentar uma vez
      clearToken();
      const newToken = await getToken();
      return await makeRequest(newToken);
    }
    throw err;
  }
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
