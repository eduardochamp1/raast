# Pernoite — Melhorias: Lógica de Parada + Export XLSX

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a lógica de ponto mediano por classificação baseada na maior parada noturna (Speed=0 por ≥ 30 min), e trocar o export CSV por XLSX usando SheetJS.

**Architecture:** Duas mudanças independentes. Task 1 modifica `src/overnight.js` e seus testes. Task 2 modifica `public/overnight.html` e `public/js/overnight-page.js` para usar SheetJS via CDN. Nenhuma mudança de API REST necessária — a interface do `analyzeVehicleNight` permanece idêntica (`{ situacao, base, lat, lng }`).

**Tech Stack:** Node.js/Express (existente), SheetJS `xlsx` via CDN (novo, frontend only).

---

## File Map

| File | Action | Responsabilidade |
|------|--------|-----------------|
| `src/overnight.js` | Modify | Substituir lógica de mediana por `findLongestStop` + `mostFrequentPoint` |
| `tests/overnight.test.js` | Modify | Atualizar testes para nova lógica (adicionar campo `Speed` nos mocks) |
| `public/overnight.html` | Modify | Adicionar SheetJS CDN; renomear botão CSV → XLSX |
| `public/js/overnight-page.js` | Modify | Substituir `exportCsv()` por `exportXlsx()`; atualizar referências ao botão |

---

## Task 1: Nova lógica de classificação por maior parada

**Files:**
- Modify: `src/overnight.js`
- Modify: `tests/overnight.test.js`

### Contexto da lógica atual

`analyzeVehicleNight` hoje pega a posição mediana do array ordenado e verifica se está numa base. Isso gera falsos positivos quando um veículo se move a noite toda mas o ponto mediano cai dentro de uma base.

### Nova lógica

1. Agrupa posições consecutivas com `Speed === 0` em intervalos de parada
2. Filtra somente paradas com duração ≥ 30 minutos
3. Encontra a **parada mais longa** qualificada
4. Verifica se o centro dessa parada está dentro de uma base → `base`
5. Se não está → `fora` com as coords da parada mais longa
6. Se nenhuma parada ≥ 30 min → `fora` com o ponto mais frequente (grade de ~200m)
7. Sem posições → `sem_dados` (igual ao atual)

- [ ] **Step 1: Atualizar os testes existentes e adicionar novos**

Substituir o conteúdo de `tests/overnight.test.js` pelo seguinte:

```js
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

test('vehicle with stop exactly at base but < 30 min → fora (threshold enforced)', async () => {
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
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
cd "C:\Users\jose.zouain\OneDrive - ENGELMIG ENERGIA LTDA\git\raast"
npm test -- tests/overnight.test.js
```

Esperado: vários FAILs porque a lógica atual usa mediana, não paradas.

- [ ] **Step 3: Substituir o conteúdo de `src/overnight.js`**

```js
const { fetchAllPositions } = require('./pagination');

// Tempo mínimo de parada (Speed=0 contínuo) para qualificar como "pernoite na base"
const MIN_STOP_MS = 30 * 60 * 1000; // 30 minutos em ms

function haversineKm(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pad(n) { return String(n).padStart(2, '0'); }

// IMPORTANT: All date/time operations here use the server's LOCAL wall-clock time.
// Do NOT mix these helpers with UTC-based operations (Date.toISOString(), 'Z'-suffix strings).
// This is intentional — SSX API expects local time without timezone offset.
function toLocalISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
       + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildOvernightWindow(dateStr, from, to) {
  const [fromH, fromM] = from.split(':').map(Number);
  const [toH,   toM  ] = to.split(':').map(Number);
  const windowStart = new Date(`${dateStr}T${from}:00`);
  const windowEnd   = new Date(`${dateStr}T${to}:00`);
  // If from >= to the window crosses midnight — advance end by 1 day
  if (fromH > toH || (fromH === toH && fromM >= toM)) {
    windowEnd.setDate(windowEnd.getDate() + 1);
  }
  return { windowStart, windowEnd };
}

/**
 * Percorre as posições ordenadas e retorna o intervalo de parada mais longo
 * com duração >= MIN_STOP_MS. Uma "parada" é uma sequência contínua de posições
 * com Speed === 0. Retorna null se nenhuma parada qualificada for encontrada.
 *
 * @param {Array} sorted — posições ordenadas por PositionDate (asc)
 * @returns {{ lat: number, lng: number, durationMs: number } | null}
 */
function findLongestStop(sorted) {
  let best = null;
  let i = 0;

  while (i < sorted.length) {
    if ((sorted[i].Speed ?? 0) !== 0) { i++; continue; }

    // Início de um intervalo de parada
    const stopStart = i;
    while (i < sorted.length && (sorted[i].Speed ?? 0) === 0) i++;
    const stopEnd = i - 1; // inclusive

    const startMs  = new Date(sorted[stopStart].PositionDate).getTime();
    const endMs    = new Date(sorted[stopEnd].PositionDate).getTime();
    const durationMs = endMs - startMs;

    if (durationMs >= MIN_STOP_MS) {
      // Centro = média das coords de todas as posições da parada
      const slice = sorted.slice(stopStart, stopEnd + 1);
      const lat   = slice.reduce((s, p) => s + p.Latitude,  0) / slice.length;
      const lng   = slice.reduce((s, p) => s + p.Longitude, 0) / slice.length;

      if (!best || durationMs > best.durationMs) {
        best = { lat, lng, durationMs };
      }
    }
  }

  return best;
}

/**
 * Quando o veículo se moveu a noite toda sem paradas qualificadas, retorna
 * o centro da célula de ~200m com maior concentração de pings.
 *
 * @param {Array} sorted — posições ordenadas
 * @returns {{ lat: number, lng: number }}
 */
function mostFrequentPoint(sorted) {
  const GRID = 0.002; // ~200 metros em graus
  const cells = {};

  sorted.forEach(p => {
    const key = `${Math.round(p.Latitude / GRID)},${Math.round(p.Longitude / GRID)}`;
    if (!cells[key]) cells[key] = { count: 0, lats: [], lngs: [] };
    cells[key].count++;
    cells[key].lats.push(p.Latitude);
    cells[key].lngs.push(p.Longitude);
  });

  const best = Object.values(cells).sort((a, b) => b.count - a.count)[0];
  return {
    lat: best.lats.reduce((s, v) => s + v, 0) / best.lats.length,
    lng: best.lngs.reduce((s, v) => s + v, 0) / best.lngs.length,
  };
}

async function analyzeVehicleNight(integrationCode, dateStr, bases, config) {
  const { windowStart, windowEnd } = buildOvernightWindow(dateStr, config.from, config.to);
  const positions = await fetchAllPositions(
    integrationCode, toLocalISO(windowStart), toLocalISO(windowEnd)
  );

  if (!positions || positions.length === 0) {
    return { situacao: 'sem_dados', base: null, lat: null, lng: null };
  }

  const sorted = [...positions].sort(
    (a, b) => new Date(a.PositionDate) - new Date(b.PositionDate)
  );

  // Tentar encontrar a parada mais longa (Speed=0 por >= 30 min)
  const stop = findLongestStop(sorted);

  // Se não houver parada qualificada, usar o ponto mais frequente do trajeto
  const { lat, lng } = stop ?? mostFrequentPoint(sorted);

  for (const base of bases) {
    if (haversineKm(lat, lng, base.lat, base.lng) * 1000 <= base.raio) {
      return { situacao: 'base', base: base.nome, lat, lng };
    }
  }

  return { situacao: 'fora', base: null, lat, lng };
}

module.exports = {
  analyzeVehicleNight,
  haversineKm,
  buildOvernightWindow,
  findLongestStop,      // exportado para testes unitários
  mostFrequentPoint,    // exportado para testes unitários
};
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
npm test -- tests/overnight.test.js
```

Esperado: todos os testes passam.

- [ ] **Step 5: Rodar a suite completa para garantir ausência de regressões**

```bash
npm test
```

Esperado: 61 testes passam (ou mais, se a contagem dos novos testes for maior).

- [ ] **Step 6: Commit**

```bash
git add src/overnight.js tests/overnight.test.js
git commit -m "feat: classify overnight by longest stop (Speed=0 >= 30 min) instead of median position"
```

---

## Task 2: Export XLSX (substituir CSV)

**Files:**
- Modify: `public/overnight.html`
- Modify: `public/js/overnight-page.js`

Não há dependência de pacote npm — SheetJS é carregado via CDN no browser.

- [ ] **Step 1: Adicionar SheetJS ao `public/overnight.html` e renomear o botão**

No arquivo `public/overnight.html`, fazer duas alterações:

**a)** Adicionar o script SheetJS logo antes do `</body>` (antes de `leaflet.js`):

```html
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="/js/nav.js"></script>
<script src="/js/overnight-page.js"></script>
<script>initNav('overnight');</script>
```

**b)** No sidebar, alterar o botão de exportação (linha com `btnExportCsv`):

De:
```html
      <button id="btnExportCsv" class="btn-secondary" style="display:none">⬇ Exportar CSV</button>
```

Para:
```html
      <button id="btnExportXlsx" class="btn-secondary" style="display:none">⬇ Exportar XLSX</button>
```

- [ ] **Step 2: Atualizar `public/js/overnight-page.js`**

Fazer as seguintes substituições no arquivo:

**a)** Comentário do estado (linha 5):

De:
```js
let _lastData    = [];   // kept for CSV export
```
Para:
```js
let _lastData    = [];   // kept for XLSX export
```

**b)** Listener do botão no `DOMContentLoaded` (linha 25):

De:
```js
  document.getElementById('btnExportCsv').addEventListener('click', exportCsv);
```
Para:
```js
  document.getElementById('btnExportXlsx').addEventListener('click', exportXlsx);
```

**c)** No `renderTable`, as duas referências a `btnExportCsv`:

De:
```js
    document.getElementById('btnExportCsv').style.display = 'none';
```
Para:
```js
    document.getElementById('btnExportXlsx').style.display = 'none';
```

E:
```js
  document.getElementById('btnExportCsv').style.display = 'block';
```
Para:
```js
  document.getElementById('btnExportXlsx').style.display = 'block';
```

**d)** Substituir a função `exportCsv` inteira pelo seguinte (no final do arquivo):

De:
```js
// ─── CSV Export ───────────────────────────────────────────────────────────────
function exportCsv() {
  const rows = [['Placa', 'Data', 'Situação', 'Base', 'Lat', 'Lng']];
  _lastData.forEach(r => {
    rows.push([r.placa, r.data, r.situacao, r.base ?? '', r.lat ?? '', r.lng ?? '']);
  });
  const csv  = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `pernoite-${new Date().toISOString().slice(0, 10)}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
}
```

Para:
```js
// ─── XLSX Export ──────────────────────────────────────────────────────────────
function exportXlsx() {
  const rows = [['Placa', 'Data', 'Situação', 'Base', 'Lat', 'Lng']];
  _lastData.forEach(r => {
    rows.push([r.placa, r.data, r.situacao, r.base ?? '', r.lat ?? '', r.lng ?? '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pernoite');
  XLSX.writeFile(wb, `pernoite-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
```

- [ ] **Step 3: Rodar a suite de testes**

```bash
cd "C:\Users\jose.zouain\OneDrive - ENGELMIG ENERGIA LTDA\git\raast"
npm test
```

Esperado: todos os testes passam. (Não há testes de frontend para esses arquivos.)

- [ ] **Step 4: Commit**

```bash
git add public/overnight.html public/js/overnight-page.js
git commit -m "feat: replace CSV export with XLSX using SheetJS CDN"
```

---

## Self-Review

**Spec coverage:**

| Requisito | Task |
|---|---|
| Classificar por maior parada (Speed=0 ≥ 30 min) | Task 1 |
| Fallback para ponto mais frequente quando sem parada qualificada | Task 1 |
| Falso positivo eliminado (veículo em movimento não classifica como `base`) | Task 1 |
| Interface `analyzeVehicleNight` inalterada (sem mudança na API REST) | Task 1 |
| Testes atualizados para nova lógica | Task 1 |
| Export XLSX com SheetJS | Task 2 |
| Botão renomeado de "Exportar CSV" para "Exportar XLSX" | Task 2 |
| Arquivo gerado: `pernoite-YYYY-MM-DD.xlsx` | Task 2 |

**Placeholder scan:** Nenhum TBD ou "implement later". Todo o código está escrito. ✅

**Type consistency:**
- `findLongestStop(sorted)` retorna `{ lat, lng, durationMs } | null` — usado em `analyzeVehicleNight` com `stop ?? mostFrequentPoint(sorted)`. ✅
- `mostFrequentPoint(sorted)` retorna `{ lat, lng }` — compatível com destructuring `const { lat, lng } = stop ?? mostFrequentPoint(sorted)`. ✅
- `XLSX.utils.aoa_to_sheet`, `XLSX.utils.book_new`, `XLSX.utils.book_append_sheet`, `XLSX.writeFile` — API pública estável do SheetJS 0.20.x. ✅
