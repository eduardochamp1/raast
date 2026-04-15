# Módulo de Controle de Pernoite — Design Spec

## Objetivo

Detectar automaticamente quais veículos administrativos da Engelmig pernoitaram fora das bases autorizadas, identificando possível uso indevido (colaboradores levando carros para casa). O sistema classifica cada veículo por noite como **em base** ✅ ou **fora da base** ❌, exibe os resultados em tabela + mapa e gera alertas diários automáticos dentro do próprio RAAST.

---

## Arquitetura Geral

O módulo é integrado ao RAAST existente. Nenhum banco de dados novo — persistência via arquivos JSON no servidor. Aproveita integralmente: mapa Leaflet (Voyager), integração SSX (`fetchAllPositions`), e componente de dropdown multi-select.

```
RAAST
├── 🗺️  Mapa          (existente — sem alterações)
├── 🌙  Pernoite      (novo — relatório + mapa de pernoite)
└── ⚙️  Configurações  (novo — bases, grupos, horário)
```

### Novos arquivos

**Backend:**
- `data/bases.json` — bases Engelmig cadastradas
- `data/groups.json` — grupos de veículos
- `data/overnight-config.json` — janela de horário noturno
- `data/alerts.json` — alertas gerados pelo cron diário
- `src/routes/bases.js` — CRUD REST de bases
- `src/routes/groups.js` — CRUD REST de grupos
- `src/overnight.js` — lógica de análise (Haversine + classificação)
- `src/cron.js` — job diário 07h00

**Frontend:**
- `public/overnight.html` — tela de relatório de pernoite
- `public/settings.html` — tela de configurações
- `public/js/overnight.js` — lógica do relatório (mapa + tabela)
- `public/js/settings.js` — lógica de configurações (bases no mapa, grupos, horário)

---

## Modelo de Dados

### `data/bases.json`
```json
[
  {
    "id": "uuid-v4",
    "nome": "Base Norte",
    "lat": -19.912998,
    "lng": -43.940933,
    "raio": 300
  }
]
```

### `data/groups.json`
```json
[
  {
    "id": "uuid-v4",
    "nome": "Carros Administrativos",
    "placas": ["PWZ-0E13", "QMS-9891", "PVH-9070"]
  }
]
```

### `data/overnight-config.json`
```json
{
  "from": "22:00",
  "to": "06:00"
}
```

### `data/alerts.json`
```json
[
  {
    "id": "uuid-v4",
    "data": "2026-04-15",
    "placa": "QMS-9891",
    "grupo": "Carros Administrativos",
    "lat": -23.550164,
    "lng": -46.633309,
    "endereco": "Rua Augusta, São Paulo, SP",
    "visto": false
  }
]
```

---

## API REST (novos endpoints)

### Bases
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/bases` | Lista todas as bases |
| POST | `/api/bases` | Cria nova base `{ nome, lat, lng, raio }` |
| PUT | `/api/bases/:id` | Atualiza base existente |
| DELETE | `/api/bases/:id` | Remove base |

### Grupos
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/groups` | Lista todos os grupos |
| POST | `/api/groups` | Cria grupo `{ nome, placas }` |
| PUT | `/api/groups/:id` | Atualiza grupo |
| DELETE | `/api/groups/:id` | Remove grupo |

### Configuração de Horário
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/overnight/config` | Retorna `{ from, to }` |
| PUT | `/api/overnight/config` | Salva `{ from, to }` |

### Relatório
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/overnight/report?groupId=&start=&end=` | Gera relatório do período |

Resposta do relatório:
```json
[
  {
    "placa": "PWZ-0E13",
    "data": "2026-04-14",
    "situacao": "base",
    "base": "Base Norte",
    "lat": -19.912998,
    "lng": -43.940933,
    "endereco": null
  },
  {
    "placa": "QMS-9891",
    "data": "2026-04-14",
    "situacao": "fora",
    "base": null,
    "lat": -23.550164,
    "lng": -46.633309,
    "endereco": "Rua Augusta, São Paulo, SP"
  }
]
```

### Alertas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/overnight/alerts` | Lista alertas não vistos |
| PATCH | `/api/overnight/alerts/:id/visto` | Marca alerta como visto |
| GET | `/api/overnight/alerts/count` | Retorna `{ count: N }` para o badge |

---

## Lógica de Análise (`src/overnight.js`)

Função principal: `analyzeVehicleNight(integrationCode, date, bases, config)`

O relatório (`/api/overnight/report`) recebe um `groupId`, busca as `placas` do grupo em `groups.json`, e para cada placa usa `getCachedVehicles()` (de `vehicles.js`) para obter o `integrationCode` correspondente — o mesmo mapeamento que a rota de histórico já faz. Em seguida chama `analyzeVehicleNight` para cada veículo.

1. Calcula a janela noturna para a `date` informada:
   - Se `from > to` (ex: 22:00 → 06:00), janela cruza meia-noite:
     `windowStart = date 22:00`, `windowEnd = date+1 06:00`
   - Se `from < to` (ex: 00:00 → 06:00), janela é no mesmo dia
2. Chama `fetchAllPositions(integrationCode, windowStart, windowEnd)` (já existente)
3. Se não há posições: retorna `{ situacao: 'sem_dados' }`
4. Pega a **posição mediana** do período (índice central do array ordenado por data)
5. Para cada base, calcula distância via Haversine entre posição mediana e centro da base
6. Se distância ≤ raio da base → `{ situacao: 'base', base: nomeDaBase, lat, lng }`
7. Se nenhuma base → `{ situacao: 'fora', lat, lng }` + chama reverse geocoding
8. Reverse geocoding: `GET https://nominatim.openstreetmap.org/reverse?lat=&lon=&format=json` (gratuito, sem chave de API)

---

## Tela de Configurações (`settings.html`)

### Aba: Bases
- Mapa Leaflet com todas as bases já cadastradas exibidas como círculos azuis translúcidos com label do nome
- Botão **"+ Nova Base"** → ativa modo de clique no mapa (cursor crosshair)
- Clique no mapa → popup com campos: *Nome* (texto) + *Raio* (número, padrão 300m) + botões Salvar/Cancelar
- Círculo pré-visualizado em tempo real enquanto usuário digita o raio
- Clique em círculo existente → popup de edição com botão Excluir

### Aba: Grupos
- Lista de grupos com botão **"+ Novo Grupo"**
- Formulário: nome do grupo + dropdown multi-select de placas (reusa componente `dropdown.js`)
- Editar/excluir grupo existente

### Aba: Horário
- Dois campos de hora: **Das** `[HH:MM]` **às** `[HH:MM]`
- Aviso automático se janela cruza meia-noite
- Botão Salvar

---

## Tela de Relatório (`overnight.html`)

### Layout
Sidebar esquerda (240px) + mapa direita — mesmo padrão do `index.html`.

### Sidebar
- Dropdown **Grupo** (grupos cadastrados)
- Date range **De / Até**
- Botão **"Gerar Relatório"**
- Tabela de resultados com colunas: Placa | Data | Situação | Local
  - Linha verde (badge "✅ Base") ou vermelha (badge "❌ Fora")
- Botão **"Exportar CSV"** (gera download da tabela)

### Mapa
- Círculos azuis translúcidos = bases cadastradas (sempre visíveis)
- Marcador verde 🟢 = carro em base — popup: placa + nome da base
- Marcador vermelho 🔴 = carro fora — popup: placa + endereço aproximado
- `fitBounds` automático para enquadrar todos os marcadores ao gerar relatório

---

## Alertas no Sistema

### Badge no Sidebar
- Sidebar de navegação (novo componente) com links para as 3 telas
- Aba **🌙 Pernoite** exibe badge `[N]` com contagem de alertas não vistos
- Badge atualizado a cada carregamento de página via `GET /api/overnight/alerts/count`

### Painel de Alertas
- Ícone de sino 🔔 no header do sidebar abre painel lateral
- Lista de alertas: placa + grupo + data + endereço
- Botão **"Ver no mapa"** → redireciona para `overnight.html` com data pré-preenchida
- Botão **"Marcar tudo como visto"** → zera o badge

### Job Diário (`src/cron.js`)
- Usa `node-cron` (pacote npm, sem dependências pesadas)
- Roda todo dia às `07:00`
- Para cada grupo → cada placa → chama `analyzeVehicleNight` para a noite anterior
- Salva em `data/alerts.json` apenas os resultados `fora`
- Não duplica alertas (verifica se já existe entrada para placa+data)

---

## Navegação entre Telas

Novo componente de navegação no topo do sidebar (compartilhado entre as 3 páginas):

```
[🗺️ Mapa]  [🌙 Pernoite 3]  [⚙️ Config]
```

Implementado como HTML parcial incluído em cada página ou como componente JS injetado no `<body>`.

---

## Tratamento de Erros

| Situação | Comportamento |
|----------|---------------|
| Veículo sem posições na janela noturna | Linha na tabela com situação "Sem dados" em cinza |
| SSX retorna erro para um veículo | Log de erro no servidor; linha com "Erro ao buscar" na tabela |
| Nominatim indisponível | Endereço exibido como "Endereço não disponível" (lat/lng ainda mostrados) |
| `data/` não existe ao iniciar | Server cria a pasta e os arquivos JSON vazios no startup |

---

## Testes

- `tests/overnight.test.js` — testa `analyzeVehicleNight`:
  - Veículo dentro do raio de uma base → `situacao: 'base'`
  - Veículo fora de todas as bases → `situacao: 'fora'`
  - Janela noturna cruzando meia-noite → datas calculadas corretamente
  - Sem posições → `situacao: 'sem_dados'`
- `tests/bases.test.js` — testa CRUD de bases (leitura/escrita no JSON)
- `tests/groups.test.js` — testa CRUD de grupos

---

## Dependências Novas

| Pacote | Uso |
|--------|-----|
| `node-cron` | Job diário às 07h00 |
| `uuid` | Geração de IDs para bases, grupos, alertas |

Nominatim (reverse geocoding) é uma API HTTP pública — sem instalação, sem chave.
