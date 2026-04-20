'use strict';
/**
 * Tests for /api/bases — usa src/__mocks__/db.js automaticamente com jest.mock('../src/db')
 */

jest.mock('../src/config');
jest.mock('../src/logger');
jest.mock('../src/db');

const request    = require('supertest');
const express    = require('express');
const db         = require('../src/db');
const basesRouter = require('../src/routes/bases');

const app = express();
app.use(express.json());
app.use('/api/bases', basesRouter);

const s = db._stmts;

beforeEach(() => {
  jest.clearAllMocks();
  s.list.all.mockReturnValue([]);
  s.get.get.mockReturnValue(undefined);
  s.insert.run.mockReturnValue({ changes: 1 });
  s.update.run.mockReturnValue({ changes: 1 });
  s.del.run.mockReturnValue({ changes: 1 });
});

test('GET /api/bases returns array', async () => {
  s.list.all.mockReturnValue([{ id: 'abc', nome: 'Base Norte', lat: -19.9, lng: -43.9, raio: 300 }]);
  const res = await request(app).get('/api/bases');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].nome).toBe('Base Norte');
});

test('POST /api/bases creates base with generated id', async () => {
  let created = null;
  s.insert.run.mockImplementation((id, nome, lat, lng, raio) => {
    created = { id, nome, lat, lng, raio };
    return { changes: 1 };
  });
  s.get.get.mockImplementation(() => created);

  const res = await request(app).post('/api/bases')
    .send({ nome: 'Base Sul', lat: -20.1, lng: -44.0, raio: 200 });
  expect(res.status).toBe(201);
  expect(res.body.nome).toBe('Base Sul');
  expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('POST /api/bases returns 400 when required fields missing', async () => {
  const res = await request(app).post('/api/bases').send({ nome: 'X' });
  expect(res.status).toBe(400);
});

test('POST /api/bases returns 400 for whitespace-only nome', async () => {
  const res = await request(app).post('/api/bases').send({ nome: '   ', lat: -19.9, lng: -43.9, raio: 300 });
  expect(res.status).toBe(400);
});

test('POST /api/bases returns 400 for raio = 0', async () => {
  const res = await request(app).post('/api/bases').send({ nome: 'X', lat: -19.9, lng: -43.9, raio: 0 });
  expect(res.status).toBe(400);
});

test('POST /api/bases returns 400 for lat out of bounds', async () => {
  const res = await request(app).post('/api/bases').send({ nome: 'X', lat: 91, lng: -43.9, raio: 100 });
  expect(res.status).toBe(400);
});

test('PUT /api/bases/:id returns 400 for raio = -5', async () => {
  s.get.get.mockReturnValue({ id: 'abc', nome: 'Base Norte', lat: -19.9, lng: -43.9, raio: 300 });
  const res = await request(app).put('/api/bases/abc').send({ raio: -5 });
  expect(res.status).toBe(400);
});

test('PUT /api/bases/:id updates existing base', async () => {
  const existing = { id: 'abc', nome: 'Base Norte', lat: -19.9, lng: -43.9, raio: 300 };
  let call = 0;
  s.get.get.mockImplementation(() => call++ === 0 ? existing : { ...existing, raio: 500 });
  const res = await request(app).put('/api/bases/abc').send({ raio: 500 });
  expect(res.status).toBe(200);
  expect(res.body.raio).toBe(500);
});

test('PUT /api/bases/:id returns 404 when not found', async () => {
  s.get.get.mockReturnValue(undefined);
  const res = await request(app).put('/api/bases/nope').send({ raio: 100 });
  expect(res.status).toBe(404);
});

test('DELETE /api/bases/:id removes base', async () => {
  s.del.run.mockReturnValue({ changes: 1 });
  const res = await request(app).delete('/api/bases/abc');
  expect(res.status).toBe(204);
});

test('DELETE /api/bases/:id returns 404 when not found', async () => {
  s.del.run.mockReturnValue({ changes: 0 });
  const res = await request(app).delete('/api/bases/nope');
  expect(res.status).toBe(404);
});
