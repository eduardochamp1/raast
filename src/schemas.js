'use strict';
/**
 * src/schemas.js
 * Schemas Zod centralizados para todos os inputs da API.
 */

const { z } = require('zod');

// ── Bases ─────────────────────────────────────────────────────────────────────
const BaseBodySchema = z.object({
  nome: z.string().trim().min(1, 'nome é obrigatório'),
  lat:  z.coerce.number().min(-90).max(90),
  lng:  z.coerce.number().min(-180).max(180),
  raio: z.coerce.number().positive('raio deve ser positivo'),
});

const BaseBodyPatchSchema = BaseBodySchema.partial();

// ── Grupos ────────────────────────────────────────────────────────────────────
const GroupBodySchema = z.object({
  nome:   z.string().trim().min(1, 'nome é obrigatório'),
  placas: z.array(z.string().trim().min(1)).min(1, 'placas deve ser um array não vazio'),
});

const GroupBodyPatchSchema = GroupBodySchema.partial().refine(
  (d) => d.nome !== undefined || d.placas !== undefined,
  'Informe pelo menos nome ou placas'
);

// ── Overnight Config ──────────────────────────────────────────────────────────
const TimeStr = z.string().regex(/^\d{2}:\d{2}$/, 'Use o formato HH:MM').refine((t) => {
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}, 'Horário inválido');

const OvernightConfigSchema = z.object({
  from: TimeStr,
  to:   TimeStr,
});

// ── Overnight Report query ────────────────────────────────────────────────────
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD');

const OvernightReportQuerySchema = z.object({
  groupId: z.string().min(1, 'groupId é obrigatório'),
  start:   DateStr,
  end:     DateStr,
}).refine((d) => new Date(d.start) <= new Date(d.end), {
  message: 'start deve ser anterior ou igual a end',
  path: ['start'],
});

// ── History query ─────────────────────────────────────────────────────────────
const HistoryQuerySchema = z.object({
  plates:   z.string().min(1, 'plates é obrigatório'),
  start:    DateStr,
  end:      DateStr,
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).optional().default('00:00'),
  timeTo:   z.string().regex(/^\d{2}:\d{2}$/).optional().default('23:59'),
});

module.exports = {
  BaseBodySchema,
  BaseBodyPatchSchema,
  GroupBodySchema,
  GroupBodyPatchSchema,
  OvernightConfigSchema,
  OvernightReportQuerySchema,
  HistoryQuerySchema,
};
