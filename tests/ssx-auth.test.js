jest.mock('axios');
const axios = require('axios');

// Limpar módulo entre testes para resetar estado do token
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

test('getToken faz POST /Login e retorna token', async () => {
  axios.post = jest.fn().mockResolvedValue({
    data: { Token: 'token-abc-123' }
  });

  const { getToken } = require('../src/ssx-auth');
  const token = await getToken();

  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/Login'),
    expect.objectContaining({ Username: expect.any(String) })
  );
  expect(token).toBe('token-abc-123');
});

test('getToken retorna token cacheado sem nova chamada', async () => {
  axios.post = jest.fn().mockResolvedValue({
    data: { Token: 'token-cached' }
  });

  const { getToken } = require('../src/ssx-auth');
  await getToken();
  await getToken();

  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('clearToken força nova autenticação na próxima chamada', async () => {
  axios.post = jest.fn().mockResolvedValue({
    data: { Token: 'token-novo' }
  });

  const { getToken, clearToken } = require('../src/ssx-auth');
  await getToken();
  clearToken();
  await getToken();

  expect(axios.post).toHaveBeenCalledTimes(2);
});
