const request = require('supertest');
const express = require('express');

// Re-require router AFTER mock is set up
let app;
beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  jest.mock('../src/data-store');
  const basesRouter = require('../src/routes/bases');
  app = express();
  app.use(express.json());
  app.use('/api/bases', basesRouter);
});

test('GET /api/bases returns array', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'abc', nome: 'Base Norte', lat: -19.9, lng: -43.9, raio: 300 }]);
  const res = await request(app).get('/api/bases');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].nome).toBe('Base Norte');
  expect(ds.readJSON).toHaveBeenCalledWith('bases.json', []);
});

test('POST /api/bases creates base with generated id', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).post('/api/bases')
    .send({ nome: 'Base Sul', lat: -20.1, lng: -44.0, raio: 200 });
  expect(res.status).toBe(201);
  expect(res.body.nome).toBe('Base Sul');
  expect(res.body.id).toBeDefined();
  expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(ds.writeJSON).toHaveBeenCalledWith('bases.json', expect.arrayContaining([
    expect.objectContaining({ nome: 'Base Sul', raio: 200 })
  ]));
});

test('POST /api/bases returns 400 when required fields missing', async () => {
  const res = await request(app).post('/api/bases').send({ nome: 'X' });
  expect(res.status).toBe(400);
});

test('PUT /api/bases/:id updates existing base', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'abc', nome: 'Base Norte', lat: -19.9, lng: -43.9, raio: 300 }]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).put('/api/bases/abc').send({ raio: 500 });
  expect(res.status).toBe(200);
  expect(res.body.raio).toBe(500);
});

test('PUT /api/bases/:id returns 404 when not found', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([]);
  const res = await request(app).put('/api/bases/nope').send({ raio: 100 });
  expect(res.status).toBe(404);
});

test('DELETE /api/bases/:id removes base', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'abc', nome: 'Base Norte', lat: -19.9, lng: -43.9, raio: 300 }]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).delete('/api/bases/abc');
  expect(res.status).toBe(204);
  expect(ds.writeJSON).toHaveBeenCalledWith('bases.json', []);
});

test('DELETE /api/bases/:id returns 404 when not found', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([]);
  const res = await request(app).delete('/api/bases/nope');
  expect(res.status).toBe(404);
});
