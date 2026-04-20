'use strict';
const express = require('express');
const router  = express.Router();
const { randomUUID } = require('crypto');
const db      = require('../db');
const logger  = require('../logger');
const { validate } = require('../middleware/validate');
const { GroupBodySchema, GroupBodyPatchSchema } = require('../schemas');

// ── Queries preparadas ────────────────────────────────────────────────────────
const stmts = {
  list:        db.prepare('SELECT * FROM grupos ORDER BY nome'),
  get:         db.prepare('SELECT * FROM grupos WHERE id = ?'),
  placas:      db.prepare('SELECT placa FROM grupo_placas WHERE grupo_id = ? ORDER BY placa'),
  insertGrp:   db.prepare('INSERT INTO grupos (id, nome) VALUES (?, ?)'),
  updateGrp:   db.prepare('UPDATE grupos SET nome = ? WHERE id = ?'),
  deleteGrp:   db.prepare('DELETE FROM grupos WHERE id = ?'),
  deletePlacas:db.prepare('DELETE FROM grupo_placas WHERE grupo_id = ?'),
  insertPlaca: db.prepare('INSERT OR IGNORE INTO grupo_placas (grupo_id, placa) VALUES (?, ?)'),
};

/** Monta objeto de grupo com array de placas incluído */
function hydrateGroup(row) {
  if (!row) return null;
  const placas = stmts.placas.all(row.id).map((r) => r.placa);
  return { ...row, placas };
}

// GET /api/groups
router.get('/', (req, res) => {
  const groups = stmts.list.all().map(hydrateGroup);
  res.json(groups);
});

// POST /api/groups
router.post('/', validate(GroupBodySchema), (req, res) => {
  const { nome, placas } = req.body;
  const id = randomUUID();

  db.transaction(() => {
    stmts.insertGrp.run(id, nome);
    for (const p of placas) stmts.insertPlaca.run(id, p.trim());
  })();

  logger.info({ id, nome, count: placas.length }, '[groups] Grupo criado');
  res.status(201).json(hydrateGroup(stmts.get.get(id)));
});

// PUT /api/groups/:id
router.put('/:id', validate(GroupBodyPatchSchema), (req, res) => {
  const existing = stmts.get.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Grupo não encontrado' });

  const nome   = req.body.nome   ?? existing.nome;
  const placas = req.body.placas ?? stmts.placas.all(req.params.id).map((r) => r.placa);

  db.transaction(() => {
    stmts.updateGrp.run(nome, req.params.id);
    if (req.body.placas !== undefined) {
      stmts.deletePlacas.run(req.params.id);
      for (const p of placas) stmts.insertPlaca.run(req.params.id, p.trim());
    }
  })();

  logger.info({ id: req.params.id }, '[groups] Grupo atualizado');
  res.json(hydrateGroup(stmts.get.get(req.params.id)));
});

// DELETE /api/groups/:id
router.delete('/:id', (req, res) => {
  // ON DELETE CASCADE cuida de grupo_placas automaticamente
  const result = stmts.deleteGrp.run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Grupo não encontrado' });
  logger.info({ id: req.params.id }, '[groups] Grupo removido');
  res.status(204).send();
});

module.exports = router;
module.exports.hydrateGroup = hydrateGroup; // exportado para uso interno (cron)
