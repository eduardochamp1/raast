// Manual mock for axios — returns a global singleton so that jest.resetModules()
// does not break references held by test files that captured axios before resetModules.
if (!global.__axiosMockSingleton) {
  const mock = jest.fn();
  mock.post = jest.fn();
  mock.get = jest.fn();
  mock.put = jest.fn();
  mock.delete = jest.fn();
  mock.patch = jest.fn();
  mock.create = jest.fn(() => mock);
  mock.defaults = { headers: { common: {} } };
  mock.interceptors = {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() }
  };
  global.__axiosMockSingleton = mock;
}

module.exports = global.__axiosMockSingleton;
