jest.mock('../src/pagination');
jest.mock('../src/config');
jest.mock('../src/logger');
const { fetchAllPositions } = require('../src/pagination');
const { analyzeVehicleNight, haversineKm, buildOvernightWindow, findLongestStop, mostFrequentPoint } = require('../src/overnight');

const BASES  = [{ id: '1', nome: 'Base BH', lat: -19.912998, lng: -43.940933, raio: 300 }];
const CONFIG = { from: '22:00', to: '06:00' };

// Helper: cria posição com Speed=0 (parado)
function stopped(lat, lng, isoDate) {
  return { Latitude: lat, Longitude: lng, Speed: 0, EventDate: isoDate };
}
// Helper: cria posição com Speed>0 (em movimento)
function moving(lat, lng, isoDate) {
  return { Latitude: lat, Longitude: lng, Speed: 50, EventDate: isoDate };
}

// ─── haversineKm ────────────────────────────────────────────────────────────

test('haversineKm returns 0 for identical coords', () => {
  expect(haversineKm(-19.9, -43.9, -19.9, -43.9)).toBe(0);
});

test('haversineKm returns correct distance (BH→SP ≈ 491 km straight-line)', () => {
  const km = haversineKm(-19.912998, -43.940933, -23.550164, -46.633309);
  expect(km).toBeGreaterThan(488);
  expect(km).toBeLessThan(494);
});

// ─── buildOvernightWindow ───────────────────────────────────────────────────

test('window crossing midnight: end is next day', () => {
  const { windowStart, windowEnd } = buildOvernightWindow('2026-04-15', '22:00', '06:00');
  expect(windowStart.getHours()).toBe(22);
  expect(windowEnd.getDate()).toBe(16);
  expect(windowEnd.getHours()).toBe(6);
});

test('window same day: end is same date', () => {
  const { windowStart, windowEnd } = buildOvernightWindow('2026-04-15', '00:00', '06:00');
  expect(windowStart.getDate()).toBe(15);
  expect(windowEnd.getDate()).toBe(15);
  expect(windowEnd.getHours()).toBe(6);
});

// ─── analyzeVehicleNight — nova lógica por parada ──────────────────────────

test('no positions → situacao: sem_dados', async () => {
  fetchAllPositions.mockResolvedValue([]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('sem_dados');
  expect(result.lat).toBeNull();
});

test('vehicle stopped in base ≥ 30 min → situacao: base', async () => {
  // Stopped at base coords from 22:00 to 23:00 (60 min)
  fetchAllPositions.mockResolvedValue([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),
    stopped(-19.913, -43.941, '2026-04-15T22:30:00'),
    stopped(-19.913, -43.941, '2026-04-15T23:00:00'),
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('base');
  expect(result.base).toBe('Base BH');
  expect(result.lat).toBeCloseTo(-19.913, 3);
});

test('vehicle stopped outside base ≥ 30 min → situacao: fora', async () => {
  // Stopped in SP (far from BH base) for 60 min
  fetchAllPositions.mockResolvedValue([
    stopped(-23.550164, -46.633309, '2026-04-15T22:00:00'),
    stopped(-23.550164, -46.633309, '2026-04-15T22:30:00'),
    stopped(-23.550164, -46.633309, '2026-04-15T23:00:00'),
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('fora');
  expect(result.lat).toBeCloseTo(-23.550164, 3);
  expect(result.base).toBeNull();
});

test('longest stop outside base wins even if brief stop was inside base', async () => {
  // Brief stop at base (10 min — below threshold), then long stop outside
  fetchAllPositions.mockResolvedValue([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),  // base — start
    stopped(-19.913, -43.941, '2026-04-15T22:10:00'),  // base — end (10 min, < 30 min threshold)
    moving(-21.0,   -44.0,   '2026-04-15T22:30:00'),  // driving
    stopped(-23.550164, -46.633309, '2026-04-15T23:00:00'),  // SP — start
    stopped(-23.550164, -46.633309, '2026-04-16T01:00:00'),  // SP — end (120 min)
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('fora');
  expect(result.lat).toBeCloseTo(-23.550164, 3);
});

test('vehicle moving all night (no stop ≥ 30 min) → situacao: fora at most frequent point', async () => {
  // All positions moving, clustered around SP coords
  fetchAllPositions.mockResolvedValue([
    { Latitude: -23.5, Longitude: -46.6, EventDate: '2026-04-14T20:00:00Z', Speed: 50 },
    { Latitude: -23.5, Longitude: -46.6, EventDate: '2026-04-14T21:00:00Z', Speed: 0 },
    { Latitude: -23.501, Longitude: -46.601, EventDate: '2026-04-14T22:00:00Z', Speed: 0 },
    { Latitude: -23.5, Longitude: -46.6, EventDate: '2026-04-15T04:00:00Z', Speed: 0 },
    { Latitude: -23.5, Longitude: -46.6, EventDate: '2026-04-15T05:00:00Z', Speed: 40 },
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('fora');
  // Most frequent cluster is around SP, not BH
  expect(result.lat).toBeCloseTo(-23.550, 1);
});

test('vehicle with stop < 30 min at base: no qualifying stop, mostFrequentPoint clusters at base → base', async () => {
  // Two pings stopped at base coords, only 20 min apart (below 30 min threshold).
  // findLongestStop returns null (duration < MIN_STOP_MS).
  // mostFrequentPoint clusters at base coords → base-radius check passes → 'base'.
  // This is acceptable: the vehicle was spatially at the base for the entire observed window.
  fetchAllPositions.mockResolvedValue([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),
    stopped(-19.913, -43.941, '2026-04-15T22:20:00'),
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('base');
  expect(result.lat).not.toBeNull();
});

test('analyzeVehicleNight: calls fetchAllPositions with correct ISO window', async () => {
  fetchAllPositions.mockResolvedValue([
    stopped(-19.913, -43.941, '2026-04-15T23:00:00'),
    stopped(-19.913, -43.941, '2026-04-16T00:00:00'),
  ]);
  await analyzeVehicleNight('456', '2026-04-15', BASES, CONFIG);
  expect(fetchAllPositions).toHaveBeenCalledWith(
    '456',
    '2026-04-15T22:00:00',
    '2026-04-16T06:00:00'
  );
});

// ─── findLongestStop — unit tests ───────────────────────────────────────────

test('findLongestStop: single ping → null (no interval)', () => {
  const result = findLongestStop([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),
  ]);
  expect(result).toBeNull();
});

test('findLongestStop: two pings exactly 30 min apart → qualifies (boundary)', () => {
  const result = findLongestStop([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),
    stopped(-19.913, -43.941, '2026-04-15T22:30:00'),
  ]);
  expect(result).not.toBeNull();
  expect(result.durationMs).toBe(30 * 60 * 1000);
  expect(result.lat).toBeCloseTo(-19.913, 3);
});

test('findLongestStop: two pings 29 min apart → null (below threshold)', () => {
  const result = findLongestStop([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),
    stopped(-19.913, -43.941, '2026-04-15T22:29:00'),
  ]);
  expect(result).toBeNull();
});

test('findLongestStop: multiple stops, returns the longest', () => {
  const positions = [
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),  // stop A start
    stopped(-19.913, -43.941, '2026-04-15T22:45:00'),  // stop A end (45 min)
    moving(-21.0,   -44.0,   '2026-04-15T23:00:00'),  // moving
    stopped(-23.550, -46.633, '2026-04-16T00:00:00'), // stop B start
    stopped(-23.550, -46.633, '2026-04-16T02:00:00'), // stop B end (120 min) ← longest
  ];
  const result = findLongestStop(positions);
  expect(result).not.toBeNull();
  expect(result.durationMs).toBe(120 * 60 * 1000);
  expect(result.lat).toBeCloseTo(-23.550, 3);
});

// ─── mostFrequentPoint — unit tests ─────────────────────────────────────────

test('mostFrequentPoint: returns centroid of densest cluster', () => {
  const positions = [
    // SP cluster (3 pings)
    moving(-23.550, -46.633, '2026-04-15T22:00:00'),
    moving(-23.551, -46.634, '2026-04-15T23:00:00'),
    moving(-23.550, -46.633, '2026-04-16T00:00:00'),
    // BH cluster (1 ping)
    moving(-19.913, -43.941, '2026-04-16T04:00:00'),
  ];
  const result = mostFrequentPoint(positions);
  // SP cluster has 3 pings — must win over BH's 1
  expect(result.lat).toBeCloseTo(-23.550, 1);
  expect(result.lng).toBeCloseTo(-46.633, 1);
});

test('mostFrequentPoint: throws on empty array', () => {
  expect(() => mostFrequentPoint([])).toThrow('mostFrequentPoint: sorted array must not be empty');
});
