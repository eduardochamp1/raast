const request = require('supertest');
const express = require('express');

let app, ds, overnight, getCachedVehicles;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();

  jest.mock('../src/data-store');
  jest.mock('../src/overnight');
  jest.mock('../src/routes/vehicles', () => ({ getCachedVehicles: jest.fn() }));

  ds               = require('../src/data-store');
  overnight        = require('../src/overnight');
  getCachedVehicles = require('../src/routes/vehicles').getCachedVehicles;

  const overnightRouter = require('../src/routes/overnight');
  app = express();
  app.use(express.json());
  app.use('/api/overnight', overnightRouter);
});

// Config
test('GET /api/overnight/config returns stored config', async () => {
  ds.readJSON.mockReturnValue({ from: '22:00', to: '06:00' });
  const res = await request(app).get('/api/overnight/config');
  expect(res.status).toBe(200);
  expect(res.body.from).toBe('22:00');
  expect(ds.readJSON).toHaveBeenCalledWith('overnight-config.json', { from: '22:00', to: '06:00' });
});

test('PUT /api/overnight/config saves and returns config', async () => {
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).put('/api/overnight/config')
    .send({ from: '21:00', to: '05:00' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ from: '21:00', to: '05:00' });
  expect(ds.writeJSON).toHaveBeenCalledWith('overnight-config.json', { from: '21:00', to: '05:00' });
});

test('PUT /api/overnight/config returns 400 when fields missing', async () => {
  const res = await request(app).put('/api/overnight/config').send({});
  expect(res.status).toBe(400);
});

test('PUT /api/overnight/config returns 400 for invalid time format', async () => {
  const res = await request(app).put('/api/overnight/config').send({ from: 'banana', to: '06:00' });
  expect(res.status).toBe(400);
});

test('GET /api/overnight/report returns 500 when vehicle fetch fails', async () => {
  ds.readJSON
    .mockReturnValueOnce([{ id: 'g1', nome: 'Admins', placas: ['PWZ-0E13'] }])
    .mockReturnValueOnce([])
    .mockReturnValueOnce({ from: '22:00', to: '06:00' });
  getCachedVehicles.mockRejectedValue(new Error('upstream timeout'));
  const res = await request(app)
    .get('/api/overnight/report?groupId=g1&start=2026-04-14&end=2026-04-14');
  expect(res.status).toBe(500);
});

// Report
test('GET /api/overnight/report returns analyzed results', async () => {
  ds.readJSON
    .mockReturnValueOnce([{ id: 'g1', nome: 'Admins', placas: ['PWZ-0E13'] }]) // groups
    .mockReturnValueOnce([])                                                    // bases
    .mockReturnValueOnce({ from: '22:00', to: '06:00' });                       // config

  getCachedVehicles.mockResolvedValue([{ plate: 'PWZ-0E13', integrationCode: '101' }]);
  overnight.analyzeVehicleNight.mockResolvedValue({ situacao: 'base', base: 'Base BH', lat: -19.9, lng: -43.9 });

  const res = await request(app)
    .get('/api/overnight/report?groupId=g1&start=2026-04-14&end=2026-04-14');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].situacao).toBe('base');
  expect(res.body[0].placa).toBe('PWZ-0E13');
  expect(res.body[0].data).toBe('2026-04-14');
});

test('GET /api/overnight/report returns 400 when params missing', async () => {
  const res = await request(app).get('/api/overnight/report?groupId=g1');
  expect(res.status).toBe(400);
});

test('GET /api/overnight/report returns 404 when group not found', async () => {
  ds.readJSON.mockReturnValue([]);
  const res = await request(app)
    .get('/api/overnight/report?groupId=nope&start=2026-04-14&end=2026-04-14');
  expect(res.status).toBe(404);
});

// Alerts
test('GET /api/overnight/alerts returns only unread', async () => {
  ds.readJSON.mockReturnValue([
    { id: 'a1', placa: 'X', visto: false },
    { id: 'a2', placa: 'Y', visto: true },
  ]);
  const res = await request(app).get('/api/overnight/alerts');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].id).toBe('a1');
});

test('GET /api/overnight/alerts/count returns unread count', async () => {
  ds.readJSON.mockReturnValue([
    { id: 'a1', visto: false },
    { id: 'a2', visto: false },
    { id: 'a3', visto: true },
  ]);
  const res = await request(app).get('/api/overnight/alerts/count');
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(2);
});

test('PATCH /api/overnight/alerts/visto-todos marks all as seen', async () => {
  ds.readJSON.mockReturnValue([{ id: 'a1', visto: false }, { id: 'a2', visto: false }]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).patch('/api/overnight/alerts/visto-todos');
  expect(res.status).toBe(200);
  expect(ds.writeJSON).toHaveBeenCalledWith('alerts.json',
    expect.arrayContaining([expect.objectContaining({ visto: true })])
  );
});

test('PATCH /api/overnight/alerts/:id/visto marks one alert as seen', async () => {
  ds.readJSON.mockReturnValue([{ id: 'a1', placa: 'X', visto: false }]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).patch('/api/overnight/alerts/a1/visto');
  expect(res.status).toBe(200);
  expect(res.body.visto).toBe(true);
});
