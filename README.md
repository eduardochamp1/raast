# RAAST — Rastreamento e Análise de Ativos Terrestres

Sistema web de controle de frota integrado à API SSX (SystemSATX), com foco em rastreamento em tempo real, histórico de posições e controle de pernoite.

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Funcionalidades](#funcionalidades)
3. [Arquitetura](#arquitetura)
4. [Estrutura de Arquivos](#estrutura-de-arquivos)
5. [Tecnologias Utilizadas](#tecnologias-utilizadas)
6. [Configuração e Execução](#configuração-e-execução)
7. [API REST](#api-rest)
8. [Lógica de Pernoite](#lógica-de-pernoite)
9. [Cron Job](#cron-job)
10. [Testes](#testes)
11. [Variáveis de Ambiente](#variáveis-de-ambiente)

---

## Visão Geral

O RAAST é uma aplicação Node.js/Express com frontend em HTML/CSS/JavaScript puro que consome a API paginada da SSX para:

- Exibir a última posição conhecida de toda a frota em um mapa interativo (Leaflet.js)
- Consultar o histórico de trajeto de um veículo em uma data específica
- Detectar automaticamente se veículos pernoitaram fora de uma base cadastrada
- Gerar relatórios e alertas diários de pernoite irregular

Não há banco de dados relacional: toda a persistência usa arquivos JSON no diretório `data/`, o que simplifica a implantação e a operação.

---

## Funcionalidades

### 🗺 Mapa ao Vivo (`/`)
- Busca a última posição de todos os veículos via `GET /Controlws/LastPosition/GetLastPositions`
- Exibe marcadores coloridos no mapa (Leaflet + CARTO tiles)
- Dropdown de filtragem por grupo de veículos
- Atualização manual e informações no popup: placa, evento, ignição, data
- Círculos de raio para as bases cadastradas, visíveis em tempo real

### 📍 Histórico de Trajeto (`/` → aba Mapa)
- Seleciona um veículo e uma data; consulta a API SSX com paginação automática
- Traça a rota no mapa em ordem cronológica com marcadores de início/fim
- Exibe velocidade, evento e hora em cada ponto do trajeto

### 🌙 Pernoite (`/overnight.html`)
- Seleciona um grupo de veículos e um período (até 31 dias)
- Para cada veículo × dia analisa as posições no janela noturna (padrão 22:00–06:00)
- Classifica o pernoite como **base** ou **fora** usando algoritmo de parada mais longa
- Exibe resultado em tabela + mapa com marcadores verdes/vermelhos
- Exporta relatório em `.xlsx` (SheetJS)
- Streaming SSE em tempo real com barra de progresso e estimativa de tempo

### ⚙️ Configurações (`/settings.html`)
- **Bases**: cadastro, edição e exclusão de bases com localização no mapa e raio em metros
- **Grupos**: agrupamento de veículos por placa para filtrar relatórios e o mapa
- **Horário de pernoite**: configuração do intervalo noturno (formato HH:MM)

### 🔔 Alertas de Pernoite
- Painel de alertas acessível pela barra de navegação (badge de contagem)
- Alertas gerados automaticamente pelo cron diário às 07:00
- Marcação individual ou em massa como "visto"
- Link direto do alerta para a data do veículo no relatório de pernoite

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Vanilla JS + Leaflet.js + SheetJS)                │
│  ┌──────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │ index.html│ │overnight.html│ │     settings.html      │  │
│  │ (Mapa)   │ │ (Pernoite)   │ │   (Bases / Grupos)     │  │
│  └──────────┘ └──────────────┘ └────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼─────────────────────────────────┐
│  Express (server.js)                                        │
│  ┌─────────────┐ ┌──────────┐ ┌────────────────────────┐   │
│  │/api/vehicles│ │/api/bases│ │   /api/overnight        │   │
│  │/api/history │ │/api/groups│ │   /api/overnight/alerts │   │
│  └─────────────┘ └──────────┘ └────────────────────────┘   │
│                                                              │
│  src/                                                        │
│  ├── overnight.js   (algoritmo de análise de pernoite)      │
│  ├── pagination.js  (paginação SSX automática)              │
│  ├── ssx-client.js  (HTTP + retry 429)                      │
│  ├── ssx-auth.js    (login + cache de token JWT)            │
│  ├── data-store.js  (read/write JSON files)                 │
│  └── cron.js        (node-cron 07:00 diário)               │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────┐
│  API SSX (integration.systemsatx.com.br)                    │
│  POST /Auth/Login                                           │
│  POST /Controlws/LastPosition/GetLastPositions              │
│  POST /v3/Tracking/PositionHistory/List  (paginada)         │
└─────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  data/  (persistência JSON local)                           │
│  ├── bases.json            (bases cadastradas)              │
│  ├── groups.json           (grupos de veículos)             │
│  ├── overnight-config.json (horário de pernoite)            │
│  └── alerts.json           (alertas de pernoite)            │
└─────────────────────────────────────────────────────────────┘
```

---

## Estrutura de Arquivos

```
raast/
│
├── server.js                  # Ponto de entrada; monta rotas e inicia cron
│
├── src/
│   ├── ssx-auth.js            # Login na SSX, cache de token JWT, refresh automático
│   ├── ssx-client.js          # Wrapper axios: retry exponencial em 429/401
│   ├── pagination.js          # Itera todas as páginas de /PositionHistory/List
│   ├── overnight.js           # Algoritmo: parada mais longa + cluster geográfico
│   ├── data-store.js          # readJSON / writeJSON / ensureFile sobre data/
│   ├── cron.js                # Job diário às 07:00 → gera alertas de pernoite
│   └── routes/
│       ├── vehicles.js        # GET /api/vehicles  (última posição, cache 30s)
│       ├── history.js         # GET /api/history   (histórico paginado)
│       ├── bases.js           # CRUD /api/bases
│       ├── groups.js          # CRUD /api/groups
│       └── overnight.js       # GET /api/overnight/report (SSE stream)
│                              # GET|PUT /api/overnight/config
│                              # GET|PATCH /api/overnight/alerts
│
├── public/
│   ├── index.html             # Mapa ao vivo + histórico
│   ├── overnight.html         # Relatório de pernoite
│   ├── settings.html          # Configurações (bases, grupos, horário)
│   ├── style.css              # Design system dark (variáveis CSS)
│   └── js/
│       ├── nav.js             # Barra de navegação compartilhada (painel de alertas)
│       ├── app.js             # Lógica principal do mapa ao vivo
│       ├── map.js             # Helpers Leaflet (marcadores, trajeto)
│       ├── api.js             # Wrapper fetch para /api/*
│       ├── dropdown.js        # Componente dropdown de veículos
│       ├── settings.js        # Lógica da página de configurações
│       └── overnight-page.js  # Lógica do relatório de pernoite + SSE client
│
├── data/                      # Criado automaticamente na primeira execução
│   ├── bases.json
│   ├── groups.json
│   ├── overnight-config.json
│   └── alerts.json
│
├── tests/
│   ├── overnight.test.js       # 68 testes unitários e de integração
│   ├── overnight-routes.test.js
│   ├── bases.test.js
│   ├── groups.test.js
│   ├── ssx-client.test.js
│   ├── ssx-auth.test.js
│   ├── data-store.test.js
│   └── pagination.test.js
│
├── .env.example               # Variáveis de ambiente necessárias
├── package.json
└── README.md
```

---

## Tecnologias Utilizadas

| Camada | Tecnologia | Versão | Função |
|---|---|---|---|
| Runtime | **Node.js** | ≥ 18.11 | Execução server-side |
| Framework | **Express** | 4.x | Servidor HTTP e roteamento |
| HTTP Client | **Axios** | 1.x | Chamadas à API SSX com interceptors |
| Agendamento | **node-cron** | 4.x | Cron diário de alertas (07:00) |
| Ambiente | **dotenv** | 16.x | Carregamento de variáveis `.env` |
| Testes | **Jest** | 29.x | Runner de testes unitários e integração |
| Testes HTTP | **Supertest** | 7.x | Testes de endpoints Express |
| Mapa | **Leaflet.js** | 1.9.4 | Mapa interativo no browser |
| Tiles | **CARTO Voyager** | — | Tiles de mapa (OpenStreetMap) |
| Exportação | **SheetJS (xlsx)** | 0.20.3 | Geração de arquivos `.xlsx` no browser |
| Persistência | **JSON Files** | — | Armazenamento local via `data-store.js` |

---

## Configuração e Execução

### Pré-requisitos
- Node.js ≥ 18.11
- Credenciais de acesso à API SSX

### Instalação

```bash
git clone <repo>
cd raast
npm install
cp .env.example .env
# editar .env com as credenciais SSX
```

### Variáveis de ambiente obrigatórias

```env
SSX_USER=usuario@email.com
SSX_PASSWORD=sua_senha
SSX_HASH_AUTH=HASH-DE-AUTENTICACAO
SSX_CLIENT_CODE=CODIGO_DO_CLIENTE
SSX_BASE_URL=https://integration.systemsatx.com.br
PORT=3000
```

### Executar

```bash
npm run dev    # desenvolvimento (--watch, reinicia automaticamente)
npm start      # produção
npm test       # roda os 68 testes
```

---

## API REST

### Veículos

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/vehicles` | Lista todos os veículos com última posição (cache 30 s) |

### Histórico

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/history?integrationCode=X&date=YYYY-MM-DD` | Histórico de posições de um veículo em uma data |

### Bases

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/bases` | Lista todas as bases |
| POST | `/api/bases` | Cria uma base `{ nome, lat, lng, raio }` |
| PUT | `/api/bases/:id` | Atualiza uma base |
| DELETE | `/api/bases/:id` | Remove uma base |

### Grupos

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/groups` | Lista todos os grupos |
| POST | `/api/groups` | Cria um grupo `{ nome, placas[] }` |
| PUT | `/api/groups/:id` | Atualiza nome/placas |
| DELETE | `/api/groups/:id` | Remove um grupo |

### Pernoite

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/overnight/config` | Retorna o horário noturno configurado |
| PUT | `/api/overnight/config` | Atualiza `{ from, to }` em HH:MM |
| GET | `/api/overnight/report?groupId=&start=&end=` | **SSE stream** com eventos de progresso e resultado |
| GET | `/api/overnight/alerts` | Lista alertas não lidos |
| GET | `/api/overnight/alerts/count` | Contagem de alertas não lidos |
| PATCH | `/api/overnight/alerts/:id/visto` | Marca um alerta como lido |
| PATCH | `/api/overnight/alerts/visto-todos` | Marca todos como lidos |

#### Protocolo SSE — `/api/overnight/report`

```
data: {"type":"start","total":389,"estSec":1750}

data: {"type":"result","done":1,"total":389,"row":{"placa":"ABC-1234","data":"2026-03-01","situacao":"base","base":"Guarapari - ES","lat":-20.64,"lng":-40.49}}

data: {"type":"result","done":2,"total":389,"row":{...}}

...

data: {"type":"done","total":389}
```

---

## Lógica de Pernoite

O algoritmo em `src/overnight.js` classifica onde o veículo estava durante a janela noturna (padrão 22:00–06:00).

### Algoritmo (em ordem de prioridade)

```
1. Buscar todas as posições do veículo na janela noturna (SSX API paginada)

2. Se não houver posições → situacao: "sem_dados"

3. Ordenar posições por PositionDate (ASC)

4. findLongestStop():
   - Percorre as posições buscando sequências contínuas com Speed === 0
   - Qualifica somente paradas com duração ≥ 30 minutos
   - Retorna o centroide da parada mais longa (ou null se nenhuma qualifica)

5. Se nenhuma parada qualificada (veículo em movimento a noite toda):
   mostFrequentPoint():
   - Divide o espaço em células de ~200 m × 200 m (grid 0.002°)
   - Conta pings por célula
   - Retorna o centroide da célula mais densa

6. Calcular distância Haversine do ponto de referência até cada base cadastrada
   - Se distância ≤ raio_da_base → situacao: "base"
   - Caso contrário → situacao: "fora"
```

### Por que parada mais longa e não posição mediana?

A posição mediana causa **falsos positivos** quando o veículo transita por uma base durante a noite: o ping mediano pode cair dentro do raio mesmo que o veículo nunca tenha permanecido lá. A parada mais longa garante que o veículo ficou estacionado por ao menos 30 minutos no local classificado como "base".

---

## Cron Job

Arquivo: `src/cron.js`

- Executado diariamente às **07:00** (horário local do servidor)
- Analisa o dia anterior para todos os grupos/veículos cadastrados
- Gera alertas em `data/alerts.json` para veículos classificados como `fora`
- Deduplicação: não gera alerta duplicado para a mesma placa+data
- Após salvar os alertas, o badge de notificação no frontend é atualizado na próxima chamada a `/api/overnight/alerts/count`

---

## Testes

```bash
npm test
```

**68 testes | 8 suites** cobrindo:

| Suite | O que testa |
|---|---|
| `overnight.test.js` | `findLongestStop`, `mostFrequentPoint`, `haversineKm`, `buildOvernightWindow`, `analyzeVehicleNight` (integração) |
| `overnight-routes.test.js` | Todos os endpoints `/api/overnight` incluindo o protocolo SSE |
| `bases.test.js` | CRUD de bases com validação |
| `groups.test.js` | CRUD de grupos com validação |
| `ssx-client.test.js` | Retry em 401 e 500; log de erros |
| `ssx-auth.test.js` | Cache de token, refresh, hash-auth |
| `data-store.test.js` | `readJSON`, `writeJSON`, `ensureFile` |
| `pagination.test.js` | Paginação automática com múltiplas páginas |

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SSX_USER` | ✅ | Usuário da API SSX |
| `SSX_PASSWORD` | ✅ | Senha da API SSX |
| `SSX_HASH_AUTH` | ✅ | Hash de autenticação fornecido pela SSX |
| `SSX_CLIENT_CODE` | ✅ | Código do cliente na plataforma SSX |
| `SSX_BASE_URL` | ✅ | URL base da API SSX |
| `PORT` | ❌ | Porta do servidor (padrão: 3000) |
| `DATA_DIR` | ❌ | Diretório para os arquivos JSON (padrão: `./data`) |
