const fs   = require('fs');
const path = require('path');

function getDataDir() {
  return process.env.DATA_DIR || path.join(__dirname, '..', 'data');
}

function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filename, defaultValue = []) {
  ensureDataDir();
  try { return JSON.parse(fs.readFileSync(path.join(getDataDir(), filename), 'utf8')); }
  catch { return defaultValue; }
}

function writeJSON(filename, data) {
  ensureDataDir();
  fs.writeFileSync(path.join(getDataDir(), filename), JSON.stringify(data, null, 2));
}

function ensureFile(filename, defaultValue) {
  if (defaultValue === undefined) throw new Error('ensureFile: defaultValue is required');
  ensureDataDir();
  const filePath = path.join(getDataDir(), filename);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
}

module.exports = { readJSON, writeJSON, ensureFile };
