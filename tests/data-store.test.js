const path = require('path');
const os   = require('os');
const fs   = require('fs');

// Isolated temp dir — must be set before requiring data-store
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raast-ds-'));
process.env.DATA_DIR = tmpDir;

const { readJSON, writeJSON, ensureFile } = require('../src/data-store');

afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

test('readJSON returns defaultValue when file does not exist', () => {
  const result = readJSON('nonexistent.json', []);
  expect(result).toEqual([]);
});

test('writeJSON + readJSON round-trips data', () => {
  const data = [{ id: '1', nome: 'Teste' }];
  writeJSON('roundtrip.json', data);
  expect(readJSON('roundtrip.json', [])).toEqual(data);
});

test('readJSON returns defaultValue when file contains invalid JSON', () => {
  const filePath = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(filePath, 'not json');
  expect(readJSON('bad.json', [])).toEqual([]);
});

test('ensureFile creates file with default when missing', () => {
  ensureFile('config.json', { from: '22:00', to: '06:00' });
  const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf8'));
  expect(content.from).toBe('22:00');
});

test('ensureFile does NOT overwrite existing file', () => {
  writeJSON('existing.json', { value: 42 });
  ensureFile('existing.json', { value: 0 });
  expect(readJSON('existing.json', {}).value).toBe(42);
});

test('ensureFile throws when defaultValue is omitted', () => {
  expect(() => ensureFile('x.json')).toThrow('ensureFile: defaultValue is required');
});
