jest.mock('axios');
jest.mock('../src/ssx-auth');
jest.mock('../src/config');
jest.mock('../src/logger');

const axios = require('axios');
const { getToken, clearToken } = require('../src/ssx-auth');

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  getToken.mockResolvedValue('mock-token');
  clearToken.mockImplementation(() => {});
});

test('ssx faz POST com Authorization header', async () => {
  axios.post = jest.fn().mockResolvedValue({ data: [{ Plate: 'ABC-1234' }] });

  const { ssx } = require('../src/ssx-client');
  const result = await ssx('/v3/Tracking/PositionHistory/List', []);

  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/v3/Tracking/PositionHistory/List'),
    [],
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer mock-token' })
    })
  );
  expect(result).toEqual([{ Plate: 'ABC-1234' }]);
});

test('ssx renova token e retenta em caso de 401', async () => {
  const error401 = { response: { status: 401 } };
  axios.post = jest.fn()
    .mockRejectedValueOnce(error401)
    .mockResolvedValueOnce({ data: [{ Plate: 'DEF-5678' }] });

  getToken.mockResolvedValue('novo-token');

  const { ssx } = require('../src/ssx-client');
  const result = await ssx('/v3/Tracking/PositionHistory/List', []);

  expect(clearToken).toHaveBeenCalledTimes(1);
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(result).toEqual([{ Plate: 'DEF-5678' }]);
  // Verify the retry used the new token
  expect(axios.post).toHaveBeenNthCalledWith(2,
    expect.any(String),
    [],
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer novo-token' })
    })
  );
});

test('ssx lança erro em status != 401', async () => {
  axios.post = jest.fn().mockRejectedValue({ response: { status: 500 } });

  const { ssx } = require('../src/ssx-client');
  await expect(ssx('/v3/Tracking/PositionHistory/List', [])).rejects.toThrow();
});
