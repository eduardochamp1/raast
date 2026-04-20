'use strict';
const express = require('express');
const router  = express.Router();
const logger  = require('../logger');
const { getLastPositions } = require('../ssx-client');

// Cache de 5 minutos — evita chamadas repetidas ao carregar a página
let _cache   = null;
let _cacheAt = null;
let _inflight = null;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Retorna última posição de todos os veículos via /Controlws/LastPosition/GetLastPositions.
 * Campos úteis por veículo: TrackedUnitIntegrationCode, TrackedUnit (placa/nome),
 * Latitude, Longitude, EventDate, Ignition.
 */
async function getCachedVehicles() {
  if (_cache && _cacheAt && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const raw  = await getLastPositions();
    const list = Array.isArray(raw) ? raw : [];

    if (list.length === 0) {
      logger.warn('[vehicles] getLastPositions retornou array vazio');
    } else {
      logger.debug({ sample: list[0] }, '[vehicles] Primeira posição recebida');
    }

    const vehicles = list
      .filter((v) => v.TrackedUnitIntegrationCode && (v.TrackedUnit || v.Plate))
      .map((v) => ({
        integrationCode: String(v.TrackedUnitIntegrationCode),
        plate:       (v.Plate || v.TrackedUnit || '').slice(0, 8).trim(),
        description:  v.TrackedUnit || '',
        lat:          v.Latitude,
        lng:          v.Longitude,
        lastSeen:     v.EventDate || v.UpdateDate || null,
        status:       v.Ignition ? 'moving' : 'stopped',
      }))
      .filter((v) => v.plate);

    _cache   = vehicles;
    _cacheAt = Date.now();
    logger.info({ count: vehicles.length }, '[vehicles] Cache atualizado');
    return vehicles;
  })().finally(() => { _inflight = null; });

  return _inflight;
}

// GET /api/vehicles/list — placas + integrationCode para o dropdown
router.get('/list', async (req, res) => {
  try {
    const vehicles = await getCachedVehicles();
    res.json(vehicles.map((v) => ({ plate: v.plate, integrationCode: v.integrationCode })));
  } catch (err) {
    logger.error({ err }, '[vehicles] Erro ao listar veículos');
    res.status(500).json({ error: 'Falha ao buscar lista de veículos' });
  }
});

// GET /api/vehicles — todos com última posição
router.get('/', async (req, res) => {
  try {
    const vehicles    = await getCachedVehicles();
    const withPosition = vehicles.filter((v) => v.lat != null && v.lng != null);
    res.json(withPosition);
  } catch (err) {
    logger.error({ err }, '[vehicles] Erro ao buscar posições');
    res.status(500).json({ error: 'Falha ao buscar posições dos veículos' });
  }
});

module.exports = router;
module.exports.getCachedVehicles = getCachedVehicles;
