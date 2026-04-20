'use strict';
/**
 * Tests for /api/groups — usa src/__mocks__/db.js
 */

jest.mock('../src/config');
jest.mock('../src/logger');
jest.mock('../src/db');

const request      = require('supertest');
const express      = require('express');
const db           = require('../src/db');
const groupsRouter = require('../src/routes/groups');

const app = express();
app.use(express.json());
app.use('/api/groups', groupsRouter);

const s = db._stmts;

let groupsState = {};
let placasState = {};

beforeEach(() => {
  jest.clearAllMocks();
  groupsState = {};
  placasState = {};

  s.groupList.all.mockImplementation(() => Object.values(groupsState));
  s.groupGet.get.mockImplementation((id) => groupsState[id] || undefined);
  s.groupPlacas.all.mockImplementation((id) => (placasState[id] || []).map((p) => ({ placa: p })));

  s.groupInsert.run.mockImplementation((id, nome) => {
    groupsState[id] = { id, nome };
    return { changes: 1 };
  });
  s.groupUpdate.run.mockImplementation((nome, id) => {
    if (groupsState[id]) groupsState[id].nome = nome;
    return { changes: groupsState[id] ? 1 : 0 };
  });
  s.groupDel.run.mockImplementation((id) => {
    const had = !!groupsState[id];
    delete groupsState[id];
    delete placasState[id];
    return { changes: had ? 1 : 0 };
  });
  s.groupPlacaDel.run.mockImplementation((id) => {
    placasState[id] = [];
    return { changes: 1 };
  });
  s.groupPlacaIns.run.mockImplementation((gid, placa) => {
    if (!placasState[gid]) placasState[gid] = [];
    if (!placasState[gid].includes(placa)) placasState[gid].push(placa);
    return { changes: 1 };
  });

  db.transaction.mockImplementation((fn) => () => fn());
});

test('GET /api/groups returns array with placas', async () => {
  groupsState = { g1: { id: 'g1', nome: 'Admins' } };
  placasState = { g1: ['PWZ-0E13'] };
  const res = await request(app).get('/api/groups');
  expect(res.status).toBe(200);
  expect(res.body[0].nome).toBe('Admins');
  expect(res.body[0].placas).toContain('PWZ-0E13');
});

test('POST /api/groups creates group', async () => {
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
  groupsState = { g1: { id: 'g1', nome: 'Admins' } };
  placasState = { g1: ['PWZ-0E13'] };
  const res = await request(app).put('/api/groups/g1').send({ nome: 'Admins Atualizado' });
  expect(res.status).toBe(200);
  expect(res.body.nome).toBe('Admins Atualizado');
});

test('PUT /api/groups/:id returns 404 when not found', async () => {
  const res = await request(app).put('/api/groups/nope').send({ nome: 'X' });
  expect(res.status).toBe(404);
});

test('PUT /api/groups/:id returns 400 for whitespace-only nome', async () => {
  groupsState = { g1: { id: 'g1', nome: 'Admins' } };
  placasState = { g1: [] };
  const res = await request(app).put('/api/groups/g1').send({ nome: '   ' });
  expect(res.status).toBe(400);
});

test('PUT /api/groups/:id returns 400 for non-string nome', async () => {
  groupsState = { g1: { id: 'g1', nome: 'Admins' } };
  placasState = { g1: [] };
  const res = await request(app).put('/api/groups/g1').send({ nome: 42 });
  expect(res.status).toBe(400);
});

test('DELETE /api/groups/:id removes group', async () => {
  groupsState = { g1: { id: 'g1', nome: 'Admins' } };
  placasState = { g1: [] };
  const res = await request(app).delete('/api/groups/g1');
  expect(res.status).toBe(204);
});

test('DELETE /api/groups/:id returns 404 when not found', async () => {
  const res = await request(app).delete('/api/groups/nope');
  expect(res.status).toBe(404);
});
