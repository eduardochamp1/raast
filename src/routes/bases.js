const express = require('express');
const router  = express.Router();
const { randomUUID } = require('crypto');
const { readJSON, writeJSON } = require('../data-store');

router.get('/', (req, res) => {
  res.json(readJSON('bases.json', []));
});

router.post('/', (req, res) => {
  const { nome, lat, lng, raio } = req.body;
  const nomeTrimmed = typeof nome === 'string' ? nome.trim() : '';
  if (!nomeTrimmed || lat == null || lng == null || raio == null || Number(raio) <= 0
      || Number(lat) < -90 || Number(lat) > 90 || Number(lng) < -180 || Number(lng) > 180)
    return res.status(400).json({ error: 'Dados inválidos: nome obrigatório, lat [-90,90], lng [-180,180], raio > 0' });
  const bases = readJSON('bases.json', []);
  const newBase = { id: randomUUID(), nome: nomeTrimmed, lat: Number(lat), lng: Number(lng), raio: Number(raio) };
  bases.push(newBase);
  writeJSON('bases.json', bases);
  res.status(201).json(newBase);
});

router.put('/:id', (req, res) => {
  const bases = readJSON('bases.json', []);
  const idx = bases.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Base não encontrada' });
  const { nome, lat, lng, raio } = req.body;
  const newRaio = raio != null ? Number(raio) : bases[idx].raio;
  const newLat  = lat  != null ? Number(lat)  : bases[idx].lat;
  const newLng  = lng  != null ? Number(lng)  : bases[idx].lng;
  const newNome = nome != null ? (typeof nome === 'string' ? nome.trim() : '') : bases[idx].nome;
  if (!newNome || newRaio <= 0 || newLat < -90 || newLat > 90 || newLng < -180 || newLng > 180)
    return res.status(400).json({ error: 'Dados inválidos: nome obrigatório, lat [-90,90], lng [-180,180], raio > 0' });
  bases[idx] = { ...bases[idx], nome: newNome, lat: newLat, lng: newLng, raio: newRaio };
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
