const { getPositionHistory } = require('./ssx-client');

const WINDOW_HOURS = 6;

function toISO(date) {
  // Formata como "2026-01-01T06:00:00" sem timezone (tempo local)
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + '-' +
    pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + 'T' +
    pad(date.getHours()) + ':' +
    pad(date.getMinutes()) + ':' +
    pad(date.getSeconds());
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Busca todas as posições de um veículo no período, superando o limite de 500 registros
 * por chamada da SSX por meio de janelas de 6 horas.
 *
 * @param {string} integrationCode - Código de integração do veículo na SSX
 * @param {string} startISO - Início do período em tempo LOCAL sem offset de timezone,
 *   ex: '2026-01-01T00:00:00'. NÃO usar toISOString() que retorna UTC com 'Z'.
 * @param {string} endISO - Fim do período em tempo LOCAL sem offset de timezone,
 *   ex: '2026-01-31T23:59:59'. NÃO usar toISOString() que retorna UTC com 'Z'.
 * @returns {Promise<Array>} Array com todas as posições encontradas no período
 */
async function fetchAllPositions(integrationCode, startISO, endISO) {
  const results = [];
  let windowStart = new Date(startISO);
  const periodEnd = new Date(endISO);

  while (windowStart < periodEnd) {
    const windowEnd = new Date(Math.min(addHours(windowStart, WINDOW_HOURS).getTime(), periodEnd.getTime()));

    const conditions = [
      { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: integrationCode },
      { PropertyName: 'PositionDate', Condition: 'GreaterThanOrEqualTo', Value: toISO(windowStart) },
      { PropertyName: 'PositionDate', Condition: 'LessThan', Value: toISO(windowEnd) }
    ];

    const data = await getPositionHistory(conditions);
    if (Array.isArray(data)) {
      results.push(...data);
    }

    windowStart = windowEnd;
  }

  return results;
}

module.exports = { fetchAllPositions };
