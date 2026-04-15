require('dotenv').config();
const axios = require('axios');
const { getToken, clearToken } = require('./ssx-auth');

async function ssx(path, body) {
  const token = await getToken();

  try {
    const response = await axios.post(
      `${process.env.SSX_BASE_URL}${path}`,
      body,
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      // Token expirado: renovar e tentar uma vez
      clearToken();
      const newToken = await getToken();
      const retry = await axios.post(
        `${process.env.SSX_BASE_URL}${path}`,
        body,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` } }
      );
      return retry.data;
    }
    const wrapped = err instanceof Error ? err : Object.assign(new Error('SSX request failed'), err);
    throw wrapped;
  }
}

async function listVehicles() {
  return ssx('/Administration/Vehicle/v2/List', []);
}

async function getPositionHistory(conditions) {
  return ssx('/v3/Tracking/PositionHistory/List', conditions);
}

module.exports = { ssx, listVehicles, getPositionHistory };
