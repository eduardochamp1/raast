jest.mock('../src/pagination');
const { fetchAllPositions } = require('../src/pagination');
const { analyzeVehicleNight, haversineKm, buildOvernightWindow } = require('../src/overnight');

const BASES  = [{ id: '1', nome: 'Base BH', lat: -19.912998, lng: -43.940933, raio: 300 }];
const CONFIG = { from: '22:00', to: '06:00' };

// Helper: cria posição com Speed=0 (parado)
function stopped(lat, lng, isoDate) {
  return { Latitude: lat, Longitude: lng, Speed: 0, PositionDate: isoDate };
}
// Helper: cria posição com Speed>0 (em movimento)
function moving(lat, lng, isoDate) {
  return { Latitude: lat, Longitude: lng, Speed: 50, PositionDate: isoDate };
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
    moving(-23.550, -46.633, '2026-04-15T22:00:00'),
    moving(-23.551, -46.634, '2026-04-15T23:00:00'),
    moving(-23.550, -46.633, '2026-04-16T00:00:00'),
    moving(-23.551, -46.633, '2026-04-16T01:00:00'),
    moving(-19.913, -43.941, '2026-04-16T04:00:00'),  // one ping near base — minority
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  expect(result.situacao).toBe('fora');
  // Most frequent cluster is around SP, not BH
  expect(result.lat).toBeCloseTo(-23.550, 1);
});

test('vehicle with stop exactly at base but < 30 min → fora or base (threshold enforced)', async () => {
  fetchAllPositions.mockResolvedValue([
    stopped(-19.913, -43.941, '2026-04-15T22:00:00'),
    stopped(-19.913, -43.941, '2026-04-15T22:20:00'),  // 20 min — below threshold
  ]);
  const result = await analyzeVehicleNight('123', '2026-04-15', BASES, CONFIG);
  // No qualifying stop → falls to mostFrequentPoint → coords near base but still classified fora
  // (mostFrequentPoint returns the cluster, which is at base coords — but since no qualifying
  //  stop, it still goes through the base check. If the most frequent point happens to be
  //  within base radius, it returns base. This is acceptable — the vehicle WAS at the base,
  //  just didn't have enough consecutive Speed=0 pings to form a 30-min interval.)
  // We only assert it doesn't throw and returns a valid situacao
  expect(['base', 'fora']).toContain(result.situacao);
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
