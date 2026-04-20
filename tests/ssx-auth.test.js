jest.mock('axios');
jest.mock('../src/config');
jest.mock('../src/logger');
const axios = require('axios');

// Limpar módulo entre testes para resetar estado do token
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

test('getToken faz POST /Login (urlencoded) e retorna token', async () => {
  // SSX retorna AccessToken URL-encoded
  axios.post = jest.fn().mockResolvedValue({
    data: { AccessToken: 'token-abc-123' }
  });

  const { getToken } = require('../src/ssx-auth');
  const token = await getToken();

  expect(axios.post).toHaveBeenCalledTimes(1);
  // Body deve ser string URL-encoded (não objeto JSON)
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/Login'),
    expect.stringContaining('Username='),
    expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' })
    })
  );
  expect(token).toBe('token-abc-123');
});

test('getToken retorna token cacheado sem nova chamada', async () => {
  axios.post = jest.fn().mockResolvedValue({
    data: { AccessToken: 'token-cached' }
  });

  const { getToken } = require('../src/ssx-auth');
  await getToken();
  await getToken();

  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('clearToken força nova autenticação na próxima chamada', async () => {
  axios.post = jest.fn().mockResolvedValue({
    data: { AccessToken: 'token-novo' }
  });

  const { getToken, clearToken } = require('../src/ssx-auth');
  await getToken();
  clearToken();
  await getToken();

  expect(axios.post).toHaveBeenCalledTimes(2);
});

test('getToken lança erro quando resposta não contém campo de token', async () => {
  axios.post = jest.fn().mockResolvedValue({ data: { status: 'ok' } });
  const { getToken } = require('../src/ssx-auth');
  await expect(getToken()).rejects.toThrow('SSX Login: campo token não encontrado');
});
