# SSX Histórico de Veículos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma aplicação web (Node.js + Vanilla JS + Leaflet) que exibe todos os veículos rastreados num mapa e permite consultar rotas históricas por placa, período e horário via API SystemsATX (SSX).

**Architecture:** Backend Express.js atua como proxy inteligente para a API SSX — gerencia token de autenticação em memória, pagina automaticamente resultados com janelas de 6 horas (limite de 500 registros por chamada), e busca múltiplos veículos em paralelo. Frontend é uma única página HTML com Leaflet.js para o mapa e Vanilla JS para a UI.

**Tech Stack:** Node.js 18+, Express 4, Axios 1, dotenv 16, Jest 29 (testes); Leaflet.js 1.9, OpenStreetMap tiles

---

## Estrutura de Arquivos

```
raast/
├── server.js                    ← Entry point: Express + monta rotas
├── src/
│   ├── ssx-auth.js              ← Token SSX: cache em memória, renovação
│   ├── ssx-client.js            ← Wrapper HTTP para chamadas à API SSX
│   ├── pagination.js            ← Loop de janelas 6h para superar limite 500
│   └── routes/
│       ├── vehicles.js          ← GET /api/vehicles e /api/vehicles/list
│       └── history.js           ← GET /api/history (multi-veículo, paralelo)
├── public/
│   ├── index.html               ← Layout: sidebar + mapa
│   ├── style.css                ← Tema escuro
│   └── js/
│       ├── api.js               ← Fetch ao backend (vehicles, history)
│       ├── map.js               ← Leaflet: init, marcadores, rotas
│       ├── dropdown.js          ← Componente dropdown multi-select suspenso
│       └── app.js               ← Orquestrador: conecta filtros → mapa
├── tests/
│   ├── ssx-auth.test.js
│   ├── ssx-client.test.js
│   └── pagination.test.js
├── .env                         ← Credenciais (não commitar)
├── .env.example
├── .gitignore
└── package.json
```

---

## Task 1: Setup do Projeto

**Files:**
- Create: `package.json`
- Create: `.env`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Inicializar projeto e instalar dependências**

```bash
cd "C:/Users/jose.zouain/OneDrive - ENGELMIG ENERGIA LTDA/git/raast"
npm init -y
npm install express axios dotenv
npm install --save-dev jest
```

- [ ] **Step 2: Criar package.json com scripts**

Editar `package.json` para ficar assim:

```json
{
  "name": "ssx-historico-veiculos",
  "version": "1.0.0",
  "description": "Histórico de localização de veículos via API SSX",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "dotenv": "^16.0.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

- [ ] **Step 3: Criar `.env` com credenciais SSX**

```bash
cat > .env << 'EOF'
SSX_USER=api_ssx@globalrastreamento.com
SSX_PASSWORD=api@2023
SSX_HASH_AUTH=62909CCD-A962-48E7-B07B-2D9703947C84
SSX_CLIENT_CODE=18
SSX_BASE_URL=https://integration.systemsatx.com.br
PORT=3000
EOF
```

- [ ] **Step 4: Criar `.env.example`**

```
SSX_USER=seu_usuario@email.com
SSX_PASSWORD=sua_senha
SSX_HASH_AUTH=SEU-HASH-AQUI
SSX_CLIENT_CODE=SEU_CODIGO
SSX_BASE_URL=https://integration.systemsatx.com.br
PORT=3000
```

- [ ] **Step 5: Criar `.gitignore`**

```
node_modules/
.env
.superpowers/
```

- [ ] **Step 6: Criar pastas**

```bash
mkdir -p src/routes public/js tests
```

- [ ] **Step 7: Commit**

```bash
git add package.json .env.example .gitignore
git commit -m "chore: project setup — Node.js + Express + Axios + Jest"
```

---

## Task 2: Módulo de Autenticação SSX (`src/ssx-auth.js`)

**Files:**
- Create: `src/ssx-auth.js`
- Create: `tests/ssx-auth.test.js`

- [ ] **Step 1: Escrever o teste**

Criar `tests/ssx-auth.test.js`:

```js
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
```

- [ ] **Step 2: Rodar teste para confirmar que falha**

```bash
npx jest tests/ssx-auth.test.js --no-coverage
```

Esperado: `FAIL` — `Cannot find module '../src/ssx-auth'`

- [ ] **Step 3: Criar `src/ssx-auth.js`**

```js
require('dotenv').config();
const axios = require('axios');

let _token = null;
let _fetchedAt = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutos

async function getToken() {
  if (_token && _fetchedAt && Date.now() - _fetchedAt < TOKEN_TTL_MS) {
    return _token;
  }
  return _refreshToken();
}

async function _refreshToken() {
  const url = `${process.env.SSX_BASE_URL}/Login`;
  const body = {
    Username: process.env.SSX_USER,
    Password: process.env.SSX_PASSWORD,
    HashAuth: process.env.SSX_HASH_AUTH,
    ClientIntegrationCodeBus: process.env.SSX_CLIENT_CODE
  };

  const response = await axios.post(url, body);

  // A API SSX retorna o token no campo "Token" (verificar no primeiro run)
  _token = response.data.Token || response.data.token || response.data.access_token;
  if (!_token) {
    throw new Error(`SSX Login: campo token não encontrado. Resposta: ${JSON.stringify(response.data)}`);
  }

  _fetchedAt = Date.now();
  return _token;
}

function clearToken() {
  _token = null;
  _fetchedAt = null;
}

module.exports = { getToken, clearToken };
```

- [ ] **Step 4: Rodar teste**

```bash
npx jest tests/ssx-auth.test.js --no-coverage
```

Esperado: `PASS` — 3 testes passando

- [ ] **Step 5: Commit**

```bash
git add src/ssx-auth.js tests/ssx-auth.test.js
git commit -m "feat: SSX auth module with token caching"
```

---

## Task 3: HTTP Client SSX (`src/ssx-client.js`)

**Files:**
- Create: `src/ssx-client.js`
- Create: `tests/ssx-client.test.js`

- [ ] **Step 1: Escrever os testes**

Criar `tests/ssx-client.test.js`:

```js
jest.mock('axios');
jest.mock('../src/ssx-auth');

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
});

test('ssx lança erro em status != 401', async () => {
  axios.post = jest.fn().mockRejectedValue({ response: { status: 500 } });

  const { ssx } = require('../src/ssx-client');
  await expect(ssx('/v3/Tracking/PositionHistory/List', [])).rejects.toThrow();
});
```

- [ ] **Step 2: Rodar teste para confirmar que falha**

```bash
npx jest tests/ssx-client.test.js --no-coverage
```

Esperado: `FAIL` — `Cannot find module '../src/ssx-client'`

- [ ] **Step 3: Criar `src/ssx-client.js`**

```js
require('dotenv').config();
const axios = require('axios');
const { getToken, clearToken } = require('./ssx-auth');

async function ssx(path, body) {
  const token = await getToken();

  try {
    const response = await axios.post(
      `${process.env.SSX_BASE_URL}${path}`,
      body,
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      // Token expirado: renovar e tentar uma vez
      clearToken();
      const newToken = await getToken();
      const retry = await axios.post(
        `${process.env.SSX_BASE_URL}${path}`,
        body,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${newToken}` } }
      );
      return retry.data;
    }
    throw err;
  }
}

async function listVehicles() {
  return ssx('/Administration/Vehicle/v2/List', []);
}

async function getPositionHistory(conditions) {
  return ssx('/v3/Tracking/PositionHistory/List', conditions);
}

module.exports = { ssx, listVehicles, getPositionHistory };
```

- [ ] **Step 4: Rodar teste**

```bash
npx jest tests/ssx-client.test.js --no-coverage
```

Esperado: `PASS` — 3 testes passando

- [ ] **Step 5: Commit**

```bash
git add src/ssx-client.js tests/ssx-client.test.js
git commit -m "feat: SSX HTTP client with 401 auto-retry"
```

---

## Task 4: Motor de Paginação (`src/pagination.js`)

**Files:**
- Create: `src/pagination.js`
- Create: `tests/pagination.test.js`

- [ ] **Step 1: Escrever os testes**

Criar `tests/pagination.test.js`:

```js
jest.mock('../src/ssx-client');
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
```

- [ ] **Step 2: Rodar teste para confirmar que falha**

```bash
npx jest tests/pagination.test.js --no-coverage
```

Esperado: `FAIL`

- [ ] **Step 3: Criar `src/pagination.js`**

```js
const { getPositionHistory } = require('./ssx-client');

const WINDOW_HOURS = 6;

function toISO(date) {
  // Formata como "2026-01-01T06:00:00" sem timezone
  return date.toISOString().slice(0, 19);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

async function fetchAllPositions(integrationCode, startISO, endISO) {
  const results = [];
  let windowStart = new Date(startISO);
  const periodEnd = new Date(endISO);

  while (windowStart < periodEnd) {
    const windowEnd = new Date(Math.min(addHours(windowStart, WINDOW_HOURS).getTime(), periodEnd.getTime()));

    const conditions = [
      { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: integrationCode },
      { PropertyName: 'PositionDate', Condition: 'GreaterThanOrEqualTo', Value: toISO(windowStart) },
      { PropertyName: 'PositionDate', Condition: 'LessThan', Value: toISO(windowEnd) }
    ];

    const data = await getPositionHistory(conditions);
    if (Array.isArray(data)) {
      results.push(...data);
    }

    windowStart = windowEnd;
  }

  return results;
}

module.exports = { fetchAllPositions };
```

- [ ] **Step 4: Rodar todos os testes**

```bash
npx jest --no-coverage
```

Esperado: `PASS` — todos os testes passando

- [ ] **Step 5: Commit**

```bash
git add src/pagination.js tests/pagination.test.js
git commit -m "feat: pagination engine — 6h window loop for SSX 500-record limit"
```

---

## Task 5: Rota de Veículos (`src/routes/vehicles.js`)

**Files:**
- Create: `src/routes/vehicles.js`

- [ ] **Step 1: Criar `src/routes/vehicles.js`**

```js
const express = require('express');
const router = express.Router();
const { listVehicles, getPositionHistory } = require('../ssx-client');

// Cache simples de 5 minutos para evitar chamadas repetidas
let _vehiclesCache = null;
let _cacheAt = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedVehicles() {
  if (_vehiclesCache && _cacheAt && Date.now() - _cacheAt < CACHE_TTL) {
    return _vehiclesCache;
  }

  const raw = await listVehicles();
  // A API retorna array de objetos — mapear para campos conhecidos
  // NOTA: verificar campo exato no primeiro run logando `raw[0]`
  const vehicles = (Array.isArray(raw) ? raw : []).map(v => ({
    integrationCode: v.IntegrationCode || v.VehicleIntegrationCode || v.Code,
    plate: v.LicensePlate || v.Plate || v.plate,
    description: v.Description || v.Name || ''
  })).filter(v => v.integrationCode && v.plate);

  _vehiclesCache = vehicles;
  _cacheAt = Date.now();
  return vehicles;
}

// GET /api/vehicles/list — lista simples de placas para o dropdown
router.get('/list', async (req, res) => {
  try {
    const vehicles = await getCachedVehicles();
    res.json(vehicles.map(v => ({ plate: v.plate, integrationCode: v.integrationCode })));
  } catch (err) {
    console.error('Erro ao listar veículos:', err.message);
    res.status(500).json({ error: 'Falha ao buscar lista de veículos' });
  }
});

// GET /api/vehicles — todos os veículos com última posição conhecida
router.get('/', async (req, res) => {
  try {
    const vehicles = await getCachedVehicles();

    // Buscar última posição de cada veículo (últimas 48h, 1 resultado)
    const now = new Date();
    const since = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sinceISO = since.toISOString().slice(0, 19);
    const nowISO = now.toISOString().slice(0, 19);

    const results = await Promise.allSettled(
      vehicles.map(async (v) => {
        try {
          const positions = await getPositionHistory([
            { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: v.integrationCode },
            { PropertyName: 'PositionDate', Condition: 'GreaterThanOrEqualTo', Value: sinceISO },
            { PropertyName: 'PositionDate', Condition: 'LessThanOrEqualTo', Value: nowISO }
          ]);

          const sorted = (Array.isArray(positions) ? positions : [])
            .sort((a, b) => new Date(b.PositionDate) - new Date(a.PositionDate));

          const latest = sorted[0];
          if (!latest) return null;

          return {
            plate: v.plate,
            integrationCode: v.integrationCode,
            lat: latest.Latitude,
            lng: latest.Longitude,
            speed: latest.Speed ?? 0,
            course: latest.Course ?? 0,
            lastSeen: latest.PositionDate,
            status: (latest.Speed ?? 0) > 5 ? 'moving' : 'stopped'
          };
        } catch {
          return null;
        }
      })
    );

    const withPosition = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    res.json(withPosition);
  } catch (err) {
    console.error('Erro ao buscar posições:', err.message);
    res.status(500).json({ error: 'Falha ao buscar posições dos veículos' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Verificar campos da API no primeiro run (passo de descoberta)**

Após montar o servidor (Task 7), chamar manualmente e logar o primeiro resultado:

```bash
# Adicionar temporariamente em getCachedVehicles() após o await:
console.log('SSX Vehicle sample:', JSON.stringify(raw[0], null, 2));
```

Verificar os nomes exatos dos campos e corrigir o mapeamento em `getCachedVehicles()` se necessário.

- [ ] **Step 3: Commit**

```bash
git add src/routes/vehicles.js
git commit -m "feat: vehicles API routes — list and last positions"
```

---

## Task 6: Rota de Histórico (`src/routes/history.js`)

**Files:**
- Create: `src/routes/history.js`

- [ ] **Step 1: Criar `src/routes/history.js`**

```js
const express = require('express');
const router = express.Router();
const { fetchAllPositions } = require('../pagination');
const { listVehicles } = require('../ssx-client');

// GET /api/history?plates=ABC-1234,DEF-5678&start=2026-01-01&end=2026-01-31&timeFrom=00:00&timeTo=23:59
router.get('/', async (req, res) => {
  const { plates, start, end, timeFrom = '00:00', timeTo = '23:59' } = req.query;

  if (!plates || !start || !end) {
    return res.status(400).json({ error: 'Parâmetros obrigatórios: plates, start, end' });
  }

  const plateList = plates.split(',').map(p => p.trim()).filter(Boolean);
  if (plateList.length === 0) {
    return res.status(400).json({ error: 'Informe ao menos uma placa' });
  }

  try {
    // Buscar mapeamento placa → integrationCode
    const allVehicles = await (async () => {
      const raw = await listVehicles();
      return (Array.isArray(raw) ? raw : []).map(v => ({
        integrationCode: v.IntegrationCode || v.VehicleIntegrationCode || v.Code,
        plate: v.LicensePlate || v.Plate || v.plate
      }));
    })();

    const startISO = `${start}T${timeFrom}:00`;
    const endISO   = `${end}T${timeTo}:00`;

    // Buscar histórico de todos os veículos em paralelo
    const fetchPromises = plateList.map(async (plate) => {
      const vehicle = allVehicles.find(v =>
        v.plate && v.plate.toUpperCase() === plate.toUpperCase()
      );

      if (!vehicle) return { plate, positions: [], error: 'Veículo não encontrado' };

      const raw = await fetchAllPositions(vehicle.integrationCode, startISO, endISO);

      // Filtrar por horário do dia se necessário
      const [fromH, fromM] = timeFrom.split(':').map(Number);
      const [toH, toM]     = timeTo.split(':').map(Number);
      const fromMinutes = fromH * 60 + fromM;
      const toMinutes   = toH * 60 + toM;
      const needsTimeFilter = !(timeFrom === '00:00' && timeTo === '23:59');

      const positions = raw
        .filter(p => {
          if (!needsTimeFilter) return true;
          const d = new Date(p.PositionDate);
          const mins = d.getHours() * 60 + d.getMinutes();
          return mins >= fromMinutes && mins <= toMinutes;
        })
        .map(p => ({
          lat: p.Latitude,
          lng: p.Longitude,
          date: p.PositionDate,
          speed: p.Speed ?? 0,
          course: p.Course ?? 0
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      return { plate, positions };
    });

    const results = await Promise.allSettled(fetchPromises);

    const response = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        response[r.value.plate] = {
          positions: r.value.positions,
          error: r.value.error || null
        };
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Erro no histórico:', err.message);
    res.status(500).json({ error: 'Falha ao buscar histórico' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/history.js
git commit -m "feat: history API route — multi-vehicle parallel fetch with time filter"
```

---

## Task 7: Servidor Express (`server.js`)

**Files:**
- Create: `server.js`

- [ ] **Step 1: Criar `server.js`**

```js
require('dotenv').config();
const express = require('express');
const path = require('path');

const vehiclesRouter = require('./src/routes/vehicles');
const historyRouter  = require('./src/routes/history');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/history',  historyRouter);

// Fallback: serve index.html para qualquer rota não-API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚛 SSX Histórico rodando em http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Testar servidor e verificar campos SSX**

```bash
node server.js
```

Esperado: `🚛 SSX Histórico rodando em http://localhost:3000`

Em outro terminal:

```bash
curl http://localhost:3000/api/vehicles/list
```

Verificar o JSON retornado. Se `plate` ou `integrationCode` forem `undefined`, checar o log de `console.log('SSX Vehicle sample:', ...)` adicionado na Task 5 e corrigir os nomes dos campos em `src/routes/vehicles.js` e `src/routes/history.js`.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: Express server wiring — static files + API routes"
```

---

## Task 8: Layout HTML + CSS (`public/index.html`, `public/style.css`)

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

- [ ] **Step 1: Criar `public/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SSX — Histórico de Veículos</title>

  <!-- Leaflet CSS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>

  <div class="app">

    <!-- SIDEBAR -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">🚛</div>
        <div>
          <div class="sidebar-title">SSX Histórico</div>
          <div class="sidebar-sub">Rastreamento de Veículos</div>
        </div>
      </div>

      <div class="sidebar-body">

        <!-- Filtro: Veículos (dropdown suspenso) -->
        <div class="field-label">Veículos</div>
        <div class="dropdown-wrapper" id="vehicleDropdown">
          <div class="dropdown-trigger" id="dropdownTrigger">
            <div class="dropdown-tags" id="dropdownTags">
              <span class="dropdown-placeholder">Selecionar veículos...</span>
            </div>
            <span class="dropdown-chevron" id="dropdownChevron">▼</span>
          </div>
          <div class="dropdown-panel" id="dropdownPanel" style="display:none;">
            <div class="dropdown-search">
              <input type="text" id="dropdownSearch" placeholder="🔍  Buscar placa..." autocomplete="off" />
            </div>
            <div class="dropdown-actions">
              <span id="selectAllBtn">Selecionar todos</span>
              <span id="selectionCount">0 selecionados</span>
              <span id="clearSelectionBtn">Limpar</span>
            </div>
            <div class="dropdown-list" id="dropdownList">
              <div class="dropdown-loading">Carregando veículos...</div>
            </div>
          </div>
        </div>

        <!-- Filtro: Período -->
        <div class="field-label">Período</div>
        <div class="date-row">
          <input type="date" id="startDate" class="input-field" />
          <input type="date" id="endDate" class="input-field" />
        </div>

        <!-- Filtro: Horário -->
        <div class="field-label">Horário</div>
        <div class="time-row">
          <input type="time" id="timeFrom" class="input-field" value="00:00" />
          <span class="time-sep">→</span>
          <input type="time" id="timeTo" class="input-field" value="23:59" />
        </div>

        <!-- Botões -->
        <button id="searchBtn" class="btn-primary">🔍 Buscar Histórico</button>
        <button id="clearBtn" class="btn-secondary">✕ Limpar</button>

        <!-- Resumo (oculto até buscar) -->
        <div id="summarySection" class="summary-section" style="display:none;">
          <div class="field-label" style="margin-top:16px;">Resumo do Período</div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon">📍</div>
              <div class="stat-value" id="statPositions">—</div>
              <div class="stat-label">Posições</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">🛣</div>
              <div class="stat-value" id="statDistance">—</div>
              <div class="stat-label">km aprox.</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">⚡</div>
              <div class="stat-value" id="statMaxSpeed">—</div>
              <div class="stat-label">km/h máx</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon">⏱</div>
              <div class="stat-value" id="statDuration">—</div>
              <div class="stat-label">Período</div>
            </div>
          </div>
        </div>

        <!-- Mensagem de erro -->
        <div id="errorMsg" class="error-msg" style="display:none;"></div>

      </div>
    </aside>

    <!-- MAPA -->
    <main class="map-container">
      <div id="map"></div>
      <div id="loadingOverlay" class="loading-overlay" style="display:none;">
        <div class="loading-spinner"></div>
        <div class="loading-text">Buscando histórico...</div>
      </div>
    </main>

  </div>

  <!-- Leaflet JS -->
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <!-- App scripts -->
  <script src="/js/api.js"></script>
  <script src="/js/map.js"></script>
  <script src="/js/dropdown.js"></script>
  <script src="/js/app.js"></script>

</body>
</html>
```

- [ ] **Step 2: Criar `public/style.css`**

```css
/* Reset e base */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg-dark:    #0a0f1e;
  --bg-sidebar: #0f172a;
  --bg-card:    #1e293b;
  --bg-input:   #1e293b;
  --border:     #334155;
  --text:       #e2e8f0;
  --text-muted: #64748b;
  --text-sub:   #94a3b8;
  --accent:     #1d4ed8;
  --accent-hover:#2563eb;
}

html, body { height: 100%; font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg-dark); color: var(--text); }

/* Layout principal */
.app { display: flex; height: 100vh; overflow: hidden; }

/* Sidebar */
.sidebar { width: 240px; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }

.sidebar-header { padding: 14px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.sidebar-logo { width: 34px; height: 34px; background: var(--accent); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.sidebar-title { font-size: 13px; font-weight: 600; color: var(--text); }
.sidebar-sub   { font-size: 11px; color: var(--text-muted); }

.sidebar-body { padding: 14px 16px; flex: 1; overflow-y: auto; }

.field-label { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; margin-top: 14px; }
.field-label:first-child { margin-top: 0; }

/* Inputs */
.input-field { background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 12px; color: var(--text); width: 100%; outline: none; transition: border-color .15s; }
.input-field:focus { border-color: var(--accent); }
.date-row { display: flex; gap: 6px; }
.date-row .input-field { flex: 1; }
.time-row { display: flex; gap: 6px; align-items: center; }
.time-row .input-field { flex: 1; text-align: center; }
.time-sep { color: var(--text-muted); font-size: 12px; flex-shrink: 0; }

/* Botões */
.btn-primary { width: 100%; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 16px; transition: background .15s; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-secondary { width: 100%; background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border); border-radius: 8px; padding: 8px; font-size: 12px; cursor: pointer; margin-top: 6px; transition: color .15s; }
.btn-secondary:hover { color: var(--text); }

/* Dropdown suspenso */
.dropdown-wrapper { position: relative; }
.dropdown-trigger { background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; min-height: 38px; flex-wrap: wrap; transition: border-color .15s; }
.dropdown-trigger.open { border-color: var(--accent); border-radius: 8px 8px 0 0; }
.dropdown-tags { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.dropdown-placeholder { color: var(--text-muted); font-size: 12px; }
.dropdown-chevron { color: var(--text-muted); font-size: 11px; margin-left: auto; flex-shrink: 0; }

.vehicle-tag { border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 4px; }
.vehicle-tag .tag-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

.dropdown-panel { position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--accent); border-top: none; border-radius: 0 0 8px 8px; z-index: 1000; box-shadow: 0 12px 32px rgba(0,0,0,.5); }
.dropdown-search { padding: 8px 10px; border-bottom: 1px solid var(--border); }
.dropdown-search input { background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 5px; padding: 6px 10px; font-size: 12px; color: var(--text); width: 100%; outline: none; }
.dropdown-actions { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 11px; border-bottom: 1px solid var(--border); }
.dropdown-actions span { color: #3b82f6; cursor: pointer; }
.dropdown-actions #selectionCount { color: var(--text-muted); cursor: default; }
.dropdown-list { max-height: 200px; overflow-y: auto; }
.dropdown-loading { padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center; }

.dropdown-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; font-size: 12px; cursor: pointer; border-bottom: 1px solid rgba(51,65,85,.3); transition: background .1s; }
.dropdown-item:last-child { border-bottom: none; }
.dropdown-item:hover { background: #243447; }
.dropdown-item.selected { background: #1a2a44; }
.dropdown-item .item-checkbox { width: 16px; height: 16px; border: 2px solid var(--border); border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; }
.dropdown-item.selected .item-checkbox { background: var(--accent); border-color: #3b82f6; }
.dropdown-item .item-color { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dropdown-item .item-plate { flex: 1; font-weight: 600; }
.dropdown-item .item-status { font-size: 10px; }
.dropdown-item .item-status.moving  { color: #22c55e; }
.dropdown-item .item-status.stopped { color: #f59e0b; }

/* Resumo */
.summary-section { margin-top: 4px; }
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.stat-card { background: var(--bg-card); border-radius: 8px; padding: 10px; }
.stat-icon  { font-size: 16px; margin-bottom: 3px; }
.stat-value { font-size: 16px; font-weight: 700; color: var(--text); }
.stat-label { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

/* Erro */
.error-msg { background: rgba(239,68,68,.1); border: 1px solid #ef4444; border-radius: 6px; padding: 10px; font-size: 12px; color: #fca5a5; margin-top: 12px; }

/* Mapa */
.map-container { flex: 1; position: relative; }
#map { width: 100%; height: 100%; }

/* Loading overlay */
.loading-overlay { position: absolute; inset: 0; background: rgba(10,15,30,.6); backdrop-filter: blur(4px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; z-index: 500; }
.loading-spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: #3b82f6; border-radius: 50%; animation: spin .8s linear infinite; }
.loading-text { font-size: 14px; color: var(--text-sub); }
@keyframes spin { to { transform: rotate(360deg); } }

/* Leaflet overrides */
.leaflet-popup-content-wrapper { background: var(--bg-card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.leaflet-popup-tip { background: var(--bg-card); }
.leaflet-popup-content { margin: 12px 16px; font-size: 13px; }
.popup-plate { font-weight: 700; font-size: 15px; margin-bottom: 6px; }
.popup-row { color: var(--text-sub); margin-bottom: 3px; }
.popup-row span { color: var(--text); }
.leaflet-control-zoom a { background: var(--bg-card) !important; color: var(--text) !important; border-color: var(--border) !important; }
```

- [ ] **Step 3: Verificar no browser**

```bash
node server.js
```

Abrir `http://localhost:3000` — deve exibir sidebar escura + área de mapa vazia (sem erros no console).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: HTML layout and dark theme CSS"
```

---

## Task 9: Frontend API Client (`public/js/api.js`)

**Files:**
- Create: `public/js/api.js`

- [ ] **Step 1: Criar `public/js/api.js`**

```js
// Wrapper de chamadas ao backend

async function apiGetVehicles() {
  const res = await fetch('/api/vehicles');
  if (!res.ok) throw new Error(`Erro ao buscar veículos: ${res.status}`);
  return res.json();
}

async function apiGetVehicleList() {
  const res = await fetch('/api/vehicles/list');
  if (!res.ok) throw new Error(`Erro ao listar veículos: ${res.status}`);
  return res.json();
}

async function apiGetHistory({ plates, start, end, timeFrom, timeTo }) {
  const params = new URLSearchParams({ plates: plates.join(','), start, end, timeFrom, timeTo });
  const res = await fetch(`/api/history?${params}`);
  if (!res.ok) throw new Error(`Erro ao buscar histórico: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/api.js
git commit -m "feat: frontend API client module"
```

---

## Task 10: Módulo do Mapa (`public/js/map.js`)

**Files:**
- Create: `public/js/map.js`

- [ ] **Step 1: Criar `public/js/map.js`**

```js
// Paleta de 10 cores para múltiplos veículos
const PALETTE = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#a78bfa',
  '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6'
];

let _map = null;
let _vehicleMarkers = [];   // marcadores de todos os veículos
let _routeLayers = [];       // polylines e marcadores de rota
let _legendControl = null;

function initMap() {
  _map = L.map('map', { zoomControl: true }).setView([-15.8, -47.9], 5);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(_map);

  return _map;
}

function makeVehicleIcon(status, color) {
  const bg = status === 'moving' ? color : '#7c3aed';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};border:2px solid ${bg};
      box-shadow:0 0 8px ${bg};
      display:flex;align-items:center;justify-content:center;
      font-size:14px;cursor:pointer;">🚛</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function plotVehicles(vehicles, onVehicleClick) {
  clearVehicleMarkers();

  vehicles.forEach(v => {
    if (!v.lat || !v.lng) return;

    const marker = L.marker([v.lat, v.lng], {
      icon: makeVehicleIcon(v.status, '#3b82f6')
    });

    const popupHtml = `
      <div class="popup-plate">${v.plate}</div>
      <div class="popup-row">⚡ Velocidade: <span>${v.speed ?? 0} km/h</span></div>
      <div class="popup-row">🧭 Direção: <span>${v.course ?? 0}°</span></div>
      <div class="popup-row">🕐 Última pos: <span>${v.lastSeen ? v.lastSeen.replace('T',' ').slice(0,19) : '—'}</span></div>
    `;

    marker.bindPopup(popupHtml);
    marker.on('click', () => onVehicleClick(v.plate));
    marker.addTo(_map);
    _vehicleMarkers.push(marker);
  });
}

function plotRoutes(historyData, colorMap) {
  clearRoutes();

  const allLatLngs = [];
  const legendItems = [];

  Object.entries(historyData).forEach(([plate, { positions }]) => {
    if (!positions || positions.length === 0) return;

    const color = colorMap[plate] || PALETTE[0];
    const latLngs = positions.map(p => [p.lat, p.lng]);
    allLatLngs.push(...latLngs);

    // Linha da rota
    const polyline = L.polyline(latLngs, { color, weight: 3, opacity: 0.85 }).addTo(_map);
    _routeLayers.push(polyline);

    // Ponto de início (verde)
    const startDot = L.circleMarker(latLngs[0], {
      radius: 7, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2
    }).addTo(_map).bindTooltip(`${plate} — Início`);
    _routeLayers.push(startDot);

    // Ponto de fim (vermelho)
    const endDot = L.circleMarker(latLngs[latLngs.length - 1], {
      radius: 7, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2
    }).addTo(_map).bindTooltip(`${plate} — Fim`);
    _routeLayers.push(endDot);

    legendItems.push({ plate, color });
  });

  // Zoom para enquadrar todas as rotas
  if (allLatLngs.length > 0) {
    _map.fitBounds(L.latLngBounds(allLatLngs), { padding: [40, 40] });
  }

  // Legenda dinâmica
  _updateLegend(legendItems);
}

function dimVehicleMarkers(selectedPlates) {
  _vehicleMarkers.forEach(m => {
    const el = m.getElement();
    if (!el) return;
    el.style.opacity = selectedPlates.length === 0 ? '1' : '0.3';
  });
}

function restoreVehicleMarkers() {
  _vehicleMarkers.forEach(m => {
    const el = m.getElement();
    if (el) el.style.opacity = '1';
  });
}

function clearRoutes() {
  _routeLayers.forEach(l => _map.removeLayer(l));
  _routeLayers = [];
  if (_legendControl) { _map.removeControl(_legendControl); _legendControl = null; }
}

function clearVehicleMarkers() {
  _vehicleMarkers.forEach(m => _map.removeLayer(m));
  _vehicleMarkers = [];
}

function _updateLegend(items) {
  if (_legendControl) _map.removeControl(_legendControl);
  if (items.length === 0) return;

  _legendControl = L.control({ position: 'bottomleft' });
  _legendControl.onAdd = () => {
    const div = L.DomUtil.create('div');
    div.style.cssText = 'background:rgba(15,23,42,.9);border:1px solid #1e293b;border-radius:8px;padding:10px 14px;font-size:12px;color:#94a3b8;';
    div.innerHTML = items.map(i =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <div style="width:20px;height:3px;border-radius:2px;background:${i.color};"></div>
        <span style="color:#e2e8f0;">${i.plate}</span>
      </div>`
    ).join('');
    return div;
  };
  _legendControl.addTo(_map);
}

function getColorForVehicle(plate, selectedPlates) {
  const idx = selectedPlates.indexOf(plate);
  return PALETTE[idx % PALETTE.length];
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/map.js
git commit -m "feat: Leaflet map module — markers, routes, legend"
```

---

## Task 11: Dropdown Multi-Select (`public/js/dropdown.js`)

**Files:**
- Create: `public/js/dropdown.js`

- [ ] **Step 1: Criar `public/js/dropdown.js`**

```js
// Estado do dropdown
let _allVehicles = [];      // [{ plate, integrationCode, status }]
let _selected   = new Set();
let _onChangeCb = null;

// NOTA: PALETTE é definida em map.js (carregado antes) — não redeclarar aqui

function initDropdown(vehicles, onChange) {
  _allVehicles = vehicles;
  _onChangeCb  = onChange;
  _renderList(_allVehicles);
  _bindEvents();
}

function _bindEvents() {
  const trigger   = document.getElementById('dropdownTrigger');
  const panel     = document.getElementById('dropdownPanel');
  const search    = document.getElementById('dropdownSearch');
  const selectAll = document.getElementById('selectAllBtn');
  const clearBtn  = document.getElementById('clearSelectionBtn');

  // Abrir/fechar
  trigger.addEventListener('click', (e) => {
    if (e.target.closest('.vehicle-tag')) return;
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    trigger.classList.toggle('open', !open);
    document.getElementById('dropdownChevron').textContent = open ? '▼' : '▲';
    if (!open) search.focus();
  });

  // Fechar ao clicar fora
  document.addEventListener('click', (e) => {
    if (!document.getElementById('vehicleDropdown').contains(e.target)) {
      panel.style.display = 'none';
      trigger.classList.remove('open');
      document.getElementById('dropdownChevron').textContent = '▼';
    }
  });

  // ESC fecha
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      panel.style.display = 'none';
      trigger.classList.remove('open');
    }
  });

  // Busca
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    const filtered = _allVehicles.filter(v => v.plate.toLowerCase().includes(q));
    _renderList(filtered);
  });

  // Selecionar todos
  selectAll.addEventListener('click', () => {
    _allVehicles.forEach(v => _selected.add(v.plate));
    _renderList(_allVehicles);
    _updateTrigger();
    _onChangeCb && _onChangeCb(getSelectedPlates());
  });

  // Limpar
  clearBtn.addEventListener('click', () => {
    _selected.clear();
    _renderList(_allVehicles);
    _updateTrigger();
    _onChangeCb && _onChangeCb(getSelectedPlates());
  });
}

function _renderList(vehicles) {
  const list = document.getElementById('dropdownList');
  list.innerHTML = '';

  if (vehicles.length === 0) {
    list.innerHTML = '<div class="dropdown-loading">Nenhum veículo encontrado</div>';
    return;
  }

  vehicles.forEach(v => {
    const selected = _selected.has(v.plate);
    const idx = Array.from(_selected).indexOf(v.plate);
    const color = selected ? PALETTE[idx % PALETTE.length] : '#334155';

    const item = document.createElement('div');
    item.className = `dropdown-item${selected ? ' selected' : ''}`;
    item.innerHTML = `
      <div class="item-checkbox">${selected ? '✓' : ''}</div>
      <div class="item-color" style="background:${color};${selected ? `box-shadow:0 0 5px ${color};` : ''}"></div>
      <div class="item-plate">${v.plate}</div>
      <div class="item-status ${v.status}">${v.status === 'moving' ? '● Movimento' : '◉ Parado'}</div>
    `;

    item.addEventListener('click', () => {
      if (_selected.has(v.plate)) {
        _selected.delete(v.plate);
      } else {
        _selected.add(v.plate);
      }
      const q = document.getElementById('dropdownSearch').value.toLowerCase();
      const filtered = _allVehicles.filter(v => v.plate.toLowerCase().includes(q));
      _renderList(filtered);
      _updateTrigger();
      _onChangeCb && _onChangeCb(getSelectedPlates());
    });

    list.appendChild(item);
  });

  document.getElementById('selectionCount').textContent = `${_selected.size} selecionados`;
}

function _updateTrigger() {
  const tagsEl = document.getElementById('dropdownTags');
  const selected = Array.from(_selected);

  if (selected.length === 0) {
    tagsEl.innerHTML = '<span class="dropdown-placeholder">Selecionar veículos...</span>';
    return;
  }

  const visible = selected.slice(0, 2);
  const rest    = selected.length - visible.length;

  tagsEl.innerHTML = visible.map((plate, i) => {
    const color = PALETTE[i % PALETTE.length];
    return `<span class="vehicle-tag" style="background:${color}22;color:${color};">
      <span class="tag-dot" style="background:${color};"></span>${plate}
    </span>`;
  }).join('') + (rest > 0 ? `<span class="vehicle-tag" style="background:#334155;color:#94a3b8;">+${rest}</span>` : '');

  document.getElementById('selectionCount').textContent = `${_selected.size} selecionados`;
}

function getSelectedPlates() {
  return Array.from(_selected);
}

function selectPlate(plate) {
  _selected.add(plate);
  _renderList(_allVehicles);
  _updateTrigger();
}

function resetDropdown() {
  _selected.clear();
  _renderList(_allVehicles);
  _updateTrigger();
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/dropdown.js
git commit -m "feat: multi-select dropdown with search, color tags, select-all"
```

---

## Task 12: Orquestrador Principal (`public/js/app.js`)

**Files:**
- Create: `public/js/app.js`

- [ ] **Step 1: Criar `public/js/app.js`**

```js
// Datas padrão: 1º do mês atual até hoje
function getDefaultDates() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return {
    start: `${y}-${m}-01`,
    end:   `${y}-${m}-${d}`
  };
}

function setLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
  document.getElementById('searchBtn').disabled = on;
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function updateSummary(historyData) {
  let totalPositions = 0, maxSpeed = 0;
  let minDate = null, maxDate = null;

  Object.values(historyData).forEach(({ positions }) => {
    if (!positions) return;
    totalPositions += positions.length;
    positions.forEach(p => {
      if ((p.speed ?? 0) > maxSpeed) maxSpeed = p.speed;
      const d = new Date(p.date);
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });
  });

  document.getElementById('statPositions').textContent = totalPositions.toLocaleString('pt-BR');
  document.getElementById('statMaxSpeed').textContent  = maxSpeed ? `${maxSpeed}` : '—';

  // Distância aproximada (soma das distâncias entre pontos consecutivos)
  let totalKm = 0;
  Object.values(historyData).forEach(({ positions }) => {
    if (!positions || positions.length < 2) return;
    for (let i = 1; i < positions.length; i++) {
      totalKm += _haversine(positions[i-1].lat, positions[i-1].lng, positions[i].lat, positions[i].lng);
    }
  });
  document.getElementById('statDistance').textContent = totalKm > 0 ? Math.round(totalKm).toLocaleString('pt-BR') : '—';

  // Duração
  if (minDate && maxDate) {
    const hours = Math.round((maxDate - minDate) / 3600000);
    document.getElementById('statDuration').textContent = `${hours}h`;
  } else {
    document.getElementById('statDuration').textContent = '—';
  }

  document.getElementById('summarySection').style.display = 'block';
}

function _haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function main() {
  // Inicializar mapa
  initMap();

  // Definir datas padrão
  const { start, end } = getDefaultDates();
  document.getElementById('startDate').value = start;
  document.getElementById('endDate').value   = end;

  // Carregar lista de veículos para o dropdown
  let vehicleList = [];
  try {
    vehicleList = await apiGetVehicleList();
  } catch (err) {
    showError('Não foi possível carregar a lista de veículos.');
    console.error(err);
  }

  // Inicializar dropdown (sem callback de mudança ainda — liga abaixo)
  initDropdown(vehicleList, () => {});

  // Carregar todos os veículos com última posição no mapa
  try {
    const vehicles = await apiGetVehicles();
    plotVehicles(vehicles, (plate) => {
      // Ao clicar num marcador, selecionar a placa no dropdown
      selectPlate(plate);
    });
  } catch (err) {
    console.error('Erro ao carregar posições iniciais:', err);
  }

  // Botão Buscar
  document.getElementById('searchBtn').addEventListener('click', async () => {
    hideError();
    const plates  = getSelectedPlates();
    const start   = document.getElementById('startDate').value;
    const end     = document.getElementById('endDate').value;
    const timeFrom = document.getElementById('timeFrom').value;
    const timeTo   = document.getElementById('timeTo').value;

    if (plates.length === 0) { showError('Selecione ao menos um veículo.'); return; }
    if (!start || !end)       { showError('Informe o período de busca.'); return; }
    if (new Date(start) > new Date(end)) { showError('Data de início deve ser anterior à data de fim.'); return; }

    setLoading(true);
    try {
      const historyData = await apiGetHistory({ plates, start, end, timeFrom, timeTo });

      // Verificar se algum veículo retornou dados
      const hasData = Object.values(historyData).some(v => v.positions && v.positions.length > 0);
      if (!hasData) {
        showError('Nenhuma posição encontrada para o período selecionado.');
        setLoading(false);
        return;
      }

      // Mapa de cores: plate → cor
      const colorMap = {};
      plates.forEach((p, i) => { colorMap[p] = PALETTE[i % PALETTE.length]; });

      plotRoutes(historyData, colorMap);
      dimVehicleMarkers(plates);
      updateSummary(historyData);
    } catch (err) {
      showError(`Erro na busca: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  });

  // Botão Limpar
  document.getElementById('clearBtn').addEventListener('click', () => {
    hideError();
    clearRoutes();
    restoreVehicleMarkers();
    resetDropdown();
    document.getElementById('summarySection').style.display = 'none';
    const { start, end } = getDefaultDates();
    document.getElementById('startDate').value = start;
    document.getElementById('endDate').value   = end;
    document.getElementById('timeFrom').value = '00:00';
    document.getElementById('timeTo').value   = '23:59';
  });
}

// NOTA: PALETTE é definida em map.js (carregado antes) — não redeclarar aqui

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: app orchestrator — connects filters, map, and SSX history API"
```

---

## Task 13: Teste de Integração Final

- [ ] **Step 1: Rodar todos os testes**

```bash
npx jest --no-coverage
```

Esperado: todos os testes passando (ssx-auth, ssx-client, pagination)

- [ ] **Step 2: Iniciar servidor e testar no browser**

```bash
node server.js
```

Abrir `http://localhost:3000` e verificar:

1. ✅ Mapa carrega com tiles escuros
2. ✅ Dropdown de veículos popula com placas da SSX
3. ✅ Marcadores de veículos aparecem no mapa
4. ✅ Clicar num marcador preenche a placa no dropdown
5. ✅ Selecionar 1+ veículos, definir período (ex: últimos 7 dias), clicar Buscar
6. ✅ Loading aparece durante a busca
7. ✅ Rotas históricas aparecem no mapa com cores distintas
8. ✅ Legenda aparece no canto inferior esquerdo
9. ✅ Cards de resumo aparecem na sidebar
10. ✅ Botão Limpar reseta tudo

- [ ] **Step 3: Corrigir campos SSX se necessário**

Se `plate` ou `integrationCode` aparecerem como `undefined`, checar o log do console do servidor e corrigir o mapeamento de campos em `src/routes/vehicles.js` e `src/routes/history.js`.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "feat: SSX vehicle history map — complete implementation"
```

---

## Notas de Manutenção

- **Token SSX:** expira em ~60min. O módulo `ssx-auth.js` renova automaticamente com TTL de 55min.
- **Rate limit (429):** a API SSX retorna 429 se muitas chamadas forem feitas rapidamente. Para muitos veículos ou períodos longos, considerar adicionar delay entre janelas no `pagination.js`.
- **Campos SSX:** os nomes exatos dos campos da API (`IntegrationCode`, `LicensePlate`, etc.) devem ser verificados no primeiro run conforme indicado na Task 5 e Task 7.
- **PALETTE:** definida **somente em `map.js`** (carregado primeiro no index.html). `dropdown.js` e `app.js` usam a variável global — não redeclarar.
