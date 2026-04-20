jest.mock('../src/ssx-client');
jest.mock('../src/config');
jest.mock('../src/logger');
const { getPositionHistory } = require('../src/ssx-client');

beforeEach(() => jest.clearAllMocks());

test('busca janela única quando período cabe em 6h', async () => {
  getPositionHistory.mockResolvedValue([
    { Plate: 'ABC-1234', Latitude: -23.5, Longitude: -46.6, PositionDate: '2026-01-01T03:00:00', Speed: 80 }
  ]);

  const { fetchAllPositions } = require('../src/pagination');
  const result = await fetchAllPositions('COD-001', '2026-01-01T00:00:00', '2026-01-01T05:00:00');

  expect(getPositionHistory).toHaveBeenCalledTimes(1);
  expect(result).toHaveLength(1);
});

test('busca 4 janelas para período de 24h', async () => {
  getPositionHistory.mockResolvedValue([]);

  const { fetchAllPositions } = require('../src/pagination');
  await fetchAllPositions('COD-001', '2026-01-01T00:00:00', '2026-01-02T00:00:00');

  expect(getPositionHistory).toHaveBeenCalledTimes(4); // 4 janelas de 6h
});

test('agrega resultados de múltiplas janelas', async () => {
  getPositionHistory
    .mockResolvedValueOnce([{ Plate: 'ABC', PositionDate: '2026-01-01T01:00:00' }])
    .mockResolvedValueOnce([{ Plate: 'ABC', PositionDate: '2026-01-01T07:00:00' }]);

  const { fetchAllPositions } = require('../src/pagination');
  const result = await fetchAllPositions('COD-001', '2026-01-01T00:00:00', '2026-01-01T12:00:00');

  expect(result).toHaveLength(2);
});

test('passa QueryConditions corretas com datas da janela', async () => {
  getPositionHistory.mockResolvedValue([]);

  const { fetchAllPositions } = require('../src/pagination');
  await fetchAllPositions('COD-001', '2026-01-01T00:00:00', '2026-01-01T06:00:00');

  expect(getPositionHistory).toHaveBeenCalledWith([
    { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: 'COD-001' },
    { PropertyName: 'PositionDate', Condition: 'GreaterThanOrEqualTo', Value: '2026-01-01T00:00:00' },
    { PropertyName: 'PositionDate', Condition: 'LessThan', Value: '2026-01-01T06:00:00' }
  ]);
});
