'use strict';
/**
 * Tests for /api/overnight — usa src/__mocks__/db.js
 */

jest.mock('../src/config');
jest.mock('../src/logger');
jest.mock('../src/db');
jest.mock('../src/overnight');
jest.mock('../src/routes/vehicles', () => ({ getCachedVehicles: jest.fn() }));

const request           = require('supertest');
const express           = require('express');
const db                = require('../src/db');
const overnightRouter   = require('../src/routes/overnight');
const { analyzeVehicleNight } = require('../src/overnight');
const { getCachedVehicles }   = require('../src/routes/vehicles');

const app = express();
app.use(express.json());
app.use('/api/overnight', overnightRouter);

const s = db._stmts;

function parseSSE(text) {
  return text.split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

beforeEach(() => {
  jest.clearAllMocks();
  s.cfgGet.get.mockReturnValue({ from_time: '22:00', to_time: '06:00' });
  s.alertCount.get.mockReturnValue({ n: 0 });
  s.alertsUnread.all.mockReturnValue([]);
  s.alertGet.get.mockReturnValue(undefined);
  s.alertMarkOne.run.mockReturnValue({ changes: 1 });
  s.alertMarkAll.run.mockReturnValue({ changes: 1 });
  s.groupGet.get.mockReturnValue(undefined);  // por padrão: grupo não encontrado
  s.groupPlacas.all.mockReturnValue([]);
  s.list.all.mockReturnValue([]);             // bases

  db.transaction.mockImplementation((fn) => (...args) => fn(...args));
});

// ── Config ────────────────────────────────────────────────────────────────────
test('GET /api/overnight/config returns stored config', async () => {
  const res = await request(app).get('/api/overnight/config');
  expect(res.status).toBe(200);
  expect(res.body.from).toBe('22:00');
  expect(res.body.to).toBe('06:00');
});

test('PUT /api/overnight/config saves and returns config', async () => {
  s.cfgSet.run.mockImplementation((f, t) => {
    s.cfgGet.get.mockReturnValue({ from_time: f, to_time: t });
    return { changes: 1 };
  });
  const res = await request(app).put('/api/overnight/config').send({ from: '21:00', to: '05:00' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ from: '21:00', to: '05:00' });
});

test('PUT /api/overnight/config returns 400 when fields missing', async () => {
  const res = await request(app).put('/api/overnight/config').send({});
  expect(res.status).toBe(400);
});

test('PUT /api/overnight/config returns 400 for invalid time format', async () => {
  const res = await request(app).put('/api/overnight/config').send({ from: 'banana', to: '06:00' });
  expect(res.status).toBe(400);
});

// ── Alerts ────────────────────────────────────────────────────────────────────
test('GET /api/overnight/alerts returns only unread', async () => {
  const unread = [{ id: 'a1', placa: 'X', grupo: 'G', data: '2026-04-01', lat: null, lng: null, visto: 0 }];
  s.alertsUnread.all.mockReturnValue(unread);
  const res = await request(app).get('/api/overnight/alerts');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].id).toBe('a1');
});

test('GET /api/overnight/alerts/count returns unread count', async () => {
  s.alertCount.get.mockReturnValue({ n: 2 });
  const res = await request(app).get('/api/overnight/alerts/count');
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
});

test('PATCH /api/overnight/alerts/visto-todos marks all as seen', async () => {
  const res = await request(app).patch('/api/overnight/alerts/visto-todos');
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('PATCH /api/overnight/alerts/:id/visto marks one alert as seen', async () => {
  const alert = { id: 'a1', placa: 'X', grupo: 'G', data: '2026-04-01', lat: null, lng: null, visto: 0 };
  s.alertGet.get.mockReturnValue(alert);
  const res = await request(app).patch('/api/overnight/alerts/a1/visto');
  expect(res.status).toBe(200);
  expect(res.body.visto).toBe(1);
});

test('PATCH /api/overnight/alerts/:id/visto returns 404 when not found', async () => {
  s.alertGet.get.mockReturnValue(undefined);
  const res = await request(app).patch('/api/overnight/alerts/not-found/visto');
  expect(res.status).toBe(404);
});

// ── Report ────────────────────────────────────────────────────────────────────
test('GET /api/overnight/report returns 400 when params missing', async () => {
  const res = await request(app).get('/api/overnight/report?groupId=g1');
  expect(res.status).toBe(400);
});

test('GET /api/overnight/report returns 404 when group not found', async () => {
  s.groupGet.get.mockReturnValue(undefined);
  const res = await request(app)
    .get('/api/overnight/report?groupId=nope&start=2026-04-14&end=2026-04-14');
  expect(res.status).toBe(404);
});

test('GET /api/overnight/report streams analyzed results via SSE', async () => {
  s.groupGet.get.mockReturnValue({ id: 'g1', nome: 'Admins' });
  s.groupPlacas.all.mockReturnValue([{ placa: 'PWZ-0E13' }]);
  getCachedVehicles.mockResolvedValue([{ plate: 'PWZ-0E13', integrationCode: '101' }]);
  analyzeVehicleNight.mockResolvedValue({ situacao: 'base', base: 'Base BH', lat: -19.9, lng: -43.9 });

  const res = await request(app)
    .get('/api/overnight/report?groupId=g1&start=2026-04-14&end=2026-04-14');
  expect(res.status).toBe(200);

  const events  = parseSSE(res.text);
  const start   = events.find((e) => e.type === 'start');
  const results = events.filter((e) => e.type === 'result');
  const done    = events.find((e) => e.type === 'done');

  expect(start.total).toBe(1);
  expect(results).toHaveLength(1);
  expect(results[0].row.situacao).toBe('base');
  expect(results[0].row.placa).toBe('PWZ-0E13');
  expect(done).toBeTruthy();
});

test('GET /api/overnight/report streams SSE error event when vehicle fetch fails', async () => {
  s.groupGet.get.mockReturnValue({ id: 'g1', nome: 'Admins' });
  s.groupPlacas.all.mockReturnValue([{ placa: 'PWZ-0E13' }]);
  getCachedVehicles.mockRejectedValue(new Error('upstream timeout'));

  const res = await request(app)
    .get('/api/overnight/report?groupId=g1&start=2026-04-14&end=2026-04-14');
  expect(res.status).toBe(200);
  const events = parseSSE(res.text);
  expect(events.some((e) => e.type === 'error')).toBe(true);
});
