const request = require('supertest');
const express = require('express');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  jest.mock('../src/data-store');
  const groupsRouter = require('../src/routes/groups');
  app = express();
  app.use(express.json());
  app.use('/api/groups', groupsRouter);
});

test('GET /api/groups returns array', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'g1', nome: 'Admins', placas: ['PWZ-0E13'] }]);
  const res = await request(app).get('/api/groups');
  expect(res.status).toBe(200);
  expect(res.body[0].nome).toBe('Admins');
  expect(ds.readJSON).toHaveBeenCalledWith('groups.json', []);
});

test('POST /api/groups creates group', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).post('/api/groups')
    .send({ nome: 'Carros Admin', placas: ['PWZ-0E13', 'QMS-9891'] });
  expect(res.status).toBe(201);
  expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(res.body.placas).toHaveLength(2);
});

test('POST /api/groups returns 400 when fields missing', async () => {
  const res = await request(app).post('/api/groups').send({ nome: 'X' });
  expect(res.status).toBe(400);
});

test('POST /api/groups returns 400 when placas is empty array', async () => {
  const res = await request(app).post('/api/groups').send({ nome: 'X', placas: [] });
  expect(res.status).toBe(400);
});

test('POST /api/groups returns 400 when nome is whitespace-only', async () => {
  const res = await request(app).post('/api/groups').send({ nome: '   ', placas: ['PWZ-0E13'] });
  expect(res.status).toBe(400);
});

test('PUT /api/groups/:id updates group', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'g1', nome: 'Admins', placas: ['PWZ-0E13'] }]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).put('/api/groups/g1')
    .send({ nome: 'Admins Atualizado' });
  expect(res.status).toBe(200);
  expect(res.body.nome).toBe('Admins Atualizado');
});

test('PUT /api/groups/:id returns 404 when not found', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([]);
  const res = await request(app).put('/api/groups/nope').send({ nome: 'X' });
  expect(res.status).toBe(404);
});

test('PUT /api/groups/:id returns 400 for whitespace-only nome', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'g1', nome: 'Admins', placas: ['PWZ-0E13'] }]);
  const res = await request(app).put('/api/groups/g1').send({ nome: '   ' });
  expect(res.status).toBe(400);
});

test('PUT /api/groups/:id returns 400 for non-string nome', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'g1', nome: 'Admins', placas: ['PWZ-0E13'] }]);
  const res = await request(app).put('/api/groups/g1').send({ nome: 42 });
  expect(res.status).toBe(400);
});

test('DELETE /api/groups/:id removes group', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([{ id: 'g1', nome: 'Admins', placas: [] }]);
  ds.writeJSON.mockImplementation(() => {});
  const res = await request(app).delete('/api/groups/g1');
  expect(res.status).toBe(204);
  expect(ds.writeJSON).toHaveBeenCalledWith('groups.json', []);
});

test('DELETE /api/groups/:id returns 404 when not found', async () => {
  const ds = require('../src/data-store');
  ds.readJSON.mockReturnValue([]);
  const res = await request(app).delete('/api/groups/nope');
  expect(res.status).toBe(404);
});
