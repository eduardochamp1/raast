// Manual mock for ssx-auth — singleton so jest.resetModules() does not break
// references held by test files that captured getToken/clearToken before resetModules.
if (!global.__ssxAuthMockSingleton) {
  global.__ssxAuthMockSingleton = {
    getToken: jest.fn(),
    clearToken: jest.fn()
  };
}

module.exports = global.__ssxAuthMockSingleton;
