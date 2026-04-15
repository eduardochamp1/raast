jest.mock('../src/pagination');
const { fetchAllPositions } = require('../src/pagination');
const { analyzeVehicleNight, haversineKm, buildOvernightWindow } = require('../src/overnight');

const BASES = [{ id: '1', nome: 'Base BH', lat: -19.912998, lng: -43.940933, raio: 300 }];
const CONFIG = { from: '22:00', to: '06:00' };

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
  expect(windowEnd.getDate()).toBe(16); // April 16
  expect(windowEnd.getHours()).toBe(6);
});

test('window same day: end is same date', () => {
  const { windowStart, windowEnd } = buildOvernightWindow('2026-04-15', '00:00', '06:00');
  expect(windowStart.getDate()).toBe(15);
  expect(windowEnd.getDate()).toBe(15);
  expect(windowEnd.getHours()).toBe(6);
});

// ─── analyzeVehicleNight ────────────────────────────────────────────────────

test('vehicle inside base radius → situacao: base', async () => {
  fetchAllPositions.mockResolvedValue([
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-15T22:00:00' },
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-16T00:00:00' },
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-16T03:00:00' },
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('base');
  expect(result.base).toBe('Base BH');
  expect(result.lat).toBeCloseTo(-19.913);
});

test('vehicle outside all bases → situacao: fora', async () => {
  fetchAllPositions.mockResolvedValue([
    { Latitude: -23.550164, Longitude: -46.633309, PositionDate: '2026-04-15T23:00:00' },
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('fora');
  expect(result.lat).toBe(-23.550164);
  expect(result.base).toBeNull();
});

test('no positions → situacao: sem_dados', async () => {
  fetchAllPositions.mockResolvedValue([]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('sem_dados');
  expect(result.lat).toBeNull();
});

test('uses median position (not first or last)', async () => {
  // 5 positions: first/last near base, median far away
  fetchAllPositions.mockResolvedValue([
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-15T22:00:00' },
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-15T23:00:00' },
    { Latitude: -23.550164, Longitude: -46.633309, PositionDate: '2026-04-16T00:00:00' }, // median
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-16T02:00:00' },
    { Latitude: -19.913, Longitude: -43.941, PositionDate: '2026-04-16T04:00:00' },
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('fora'); // median is in SP, far from BH base
});
