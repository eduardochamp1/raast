const express = require('express');
const router  = express.Router();
const { randomUUID } = require('crypto');
const { readJSON, writeJSON } = require('../data-store');

router.get('/', (req, res) => {
  res.json(readJSON('groups.json', []));
});

router.post('/', (req, res) => {
  const { nome, placas } = req.body;
  const nomeTrimmed = typeof nome === 'string' ? nome.trim() : '';
  if (!nomeTrimmed || !Array.isArray(placas) || placas.length === 0)
    return res.status(400).json({ error: 'nome e placas (array não vazio) são obrigatórios' });
  const groups   = readJSON('groups.json', []);
  const newGroup = { id: randomUUID(), nome: nomeTrimmed, placas };
  groups.push(newGroup);
  writeJSON('groups.json', groups);
  res.status(201).json(newGroup);
});

router.put('/:id', (req, res) => {
  const groups = readJSON('groups.json', []);
  const idx    = groups.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Grupo não encontrado' });
  const { nome, placas } = req.body;
  const newNome  = nome   != null ? (typeof nome === 'string' ? nome.trim() : groups[idx].nome) : groups[idx].nome;
  const newPlacas = placas != null ? placas : groups[idx].placas;
  groups[idx] = { ...groups[idx], nome: newNome, placas: newPlacas };
  writeJSON('groups.json', groups);
  res.json(groups[idx]);
});

router.delete('/:id', (req, res) => {
  const groups    = readJSON('groups.json', []);
  const newGroups = groups.filter(g => g.id !== req.params.id);
  if (newGroups.length === groups.length)
    return res.status(404).json({ error: 'Grupo não encontrado' });
  writeJSON('groups.json', newGroups);
  res.status(204).send();
});

module.exports = router;
