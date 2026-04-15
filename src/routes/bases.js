const express = require('express');
const router  = express.Router();
const { randomUUID } = require('crypto');
const { readJSON, writeJSON } = require('../data-store');

router.get('/', (req, res) => {
  res.json(readJSON('bases.json', []));
});

router.post('/', (req, res) => {
  const { nome, lat, lng, raio } = req.body;
  if (!nome || lat == null || lng == null || raio == null)
    return res.status(400).json({ error: 'nome, lat, lng, raio são obrigatórios' });
  const bases = readJSON('bases.json', []);
  const newBase = { id: randomUUID(), nome, lat: Number(lat), lng: Number(lng), raio: Number(raio) };
  bases.push(newBase);
  writeJSON('bases.json', bases);
  res.status(201).json(newBase);
});

router.put('/:id', (req, res) => {
  const bases = readJSON('bases.json', []);
  const idx = bases.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Base não encontrada' });
  const { nome, lat, lng, raio } = req.body;
  bases[idx] = {
    ...bases[idx],
    nome:  nome  != null ? nome            : bases[idx].nome,
    lat:   lat   != null ? Number(lat)     : bases[idx].lat,
    lng:   lng   != null ? Number(lng)     : bases[idx].lng,
    raio:  raio  != null ? Number(raio)    : bases[idx].raio,
  };
  writeJSON('bases.json', bases);
  res.json(bases[idx]);
});

router.delete('/:id', (req, res) => {
  const bases    = readJSON('bases.json', []);
  const newBases = bases.filter(b => b.id !== req.params.id);
  if (newBases.length === bases.length)
    return res.status(404).json({ error: 'Base não encontrada' });
  writeJSON('bases.json', newBases);
  res.status(204).send();
});

module.exports = router;
