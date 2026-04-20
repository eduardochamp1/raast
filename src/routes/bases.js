'use strict';
const express = require('express');
const router  = express.Router();
const { randomUUID } = require('crypto');
const db      = require('../db');
const logger  = require('../logger');
const { validate } = require('../middleware/validate');
const { BaseBodySchema, BaseBodyPatchSchema } = require('../schemas');

// ── Queries preparadas (compiladas uma única vez) ─────────────────────────────
const stmts = {
  list:   db.prepare('SELECT * FROM bases ORDER BY nome'),
  get:    db.prepare('SELECT * FROM bases WHERE id = ?'),
  insert: db.prepare('INSERT INTO bases (id, nome, lat, lng, raio) VALUES (?, ?, ?, ?, ?)'),
  update: db.prepare('UPDATE bases SET nome = ?, lat = ?, lng = ?, raio = ? WHERE id = ?'),
  delete: db.prepare('DELETE FROM bases WHERE id = ?'),
};

// GET /api/bases
router.get('/', (req, res) => {
  res.json(stmts.list.all());
});

// POST /api/bases
router.post('/', validate(BaseBodySchema), (req, res) => {
  const { nome, lat, lng, raio } = req.body;
  const id = randomUUID();
  stmts.insert.run(id, nome, lat, lng, raio);
  const base = stmts.get.get(id);
  logger.info({ id, nome }, '[bases] Base criada');
  res.status(201).json(base);
});

// PUT /api/bases/:id
router.put('/:id', validate(BaseBodyPatchSchema), (req, res) => {
  const existing = stmts.get.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Base não encontrada' });

  const nome = req.body.nome ?? existing.nome;
  const lat  = req.body.lat  ?? existing.lat;
  const lng  = req.body.lng  ?? existing.lng;
  const raio = req.body.raio ?? existing.raio;

  stmts.update.run(nome, lat, lng, raio, req.params.id);
  logger.info({ id: req.params.id }, '[bases] Base atualizada');
  res.json(stmts.get.get(req.params.id));
});

// DELETE /api/bases/:id
router.delete('/:id', (req, res) => {
  const result = stmts.delete.run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Base não encontrada' });
  logger.info({ id: req.params.id }, '[bases] Base removida');
  res.status(204).send();
});

module.exports = router;
