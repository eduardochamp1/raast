# SSX Histórico de Veículos — Design Spec
**Data:** 2026-04-15  
**Status:** Aprovado

---

## Visão Geral

Sistema web para visualização de histórico de localização de veículos rastreados pela API SystemsATX (SSX). Permite ver todos os veículos no mapa em tempo real e consultar rotas históricas por período, horário e placa.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express.js |
| Frontend | HTML + Vanilla JS |
| Mapa | Leaflet.js + OpenStreetMap (gratuito) |
| Dados | API SSX (`integration.systemsatx.com.br`) |

---

## Estrutura de Arquivos

```
projeto/
├── server.js              ← Express + rotas da API + proxy SSX
├── public/
│   ├── index.html         ← Página principal (sidebar + mapa)
│   ├── app.js             ← Lógica do mapa, filtros e chamadas à API
│   └── style.css          ← Estilos (tema escuro)
├── .env                   ← Credenciais SSX (não commitar)
├── .gitignore
└── package.json
```

---

## Credenciais SSX (.env)

```env
SSX_USER=api_ssx@globalrastreamento.com
SSX_PASSWORD=api@2023
SSX_HASH_AUTH=62909CCD-A962-48E7-B07B-2D9703947C84
SSX_CLIENT_CODE=18
SSX_BASE_URL=https://integration.systemsatx.com.br
PORT=3000
```

---

## Backend (server.js)

### Autenticação SSX
- Ao iniciar, faz `POST /Login` com Username, Password, HashAuth, ClientIntegrationCodeBus
- Token armazenado em memória com timestamp
- Toda chamada à SSX usa o token no header `Authorization: Bearer <token>`
- Se receber `401`, renova token automaticamente e repete a chamada uma vez

### Endpoints expostos ao frontend

#### `GET /api/vehicles`
Retorna todos os veículos com última posição conhecida.  
Internamente chama `POST /v3/Tracking/PositionHistory/List` sem filtro de data (apenas o código de integração de cada unidade).

Resposta:
```json
[
  {
    "plate": "ABC-1234",
    "lat": -23.5505,
    "lng": -46.6333,
    "speed": 95,
    "course": 45,
    "lastSeen": "2026-01-31T08:23:15",
    "status": "moving"
  }
]
```

#### `GET /api/vehicles/list`
Lista simples de placas disponíveis para popular o dropdown.  
Retorna: `["ABC-1234", "DEF-5678", ...]`

#### `GET /api/history?plates=ABC-1234,DEF-5678&start=2026-01-01&end=2026-01-31&timeFrom=00:00&timeTo=23:59`
Retorna histórico completo de posições dos veículos solicitados no período.

**Paginação automática:** Para cada veículo, faz loop de chamadas com janelas de 6 horas até cobrir todo o período, superando o limite de 500 registros por chamada da SSX.

**Multi-veículo paralelo:** Usa `Promise.all` para buscar todos os veículos simultaneamente.

Resposta:
```json
{
  "ABC-1234": [
    { "lat": -23.55, "lng": -46.63, "date": "2026-01-01T00:10:00", "speed": 80, "course": 90 }
  ],
  "DEF-5678": [...]
}
```

---

## Frontend

### Layout
- **Sidebar fixa** (240px, esquerda) com filtros e resumo
- **Mapa Leaflet** (restante da tela, direita), tema escuro via TileLayer customizado

### Sidebar — Filtros

| Campo | Tipo | Detalhe |
|---|---|---|
| Veículos | Dropdown suspenso multi-select | Busca por placa, checkbox por veículo, tags coloridas no estado fechado, "Selecionar todos" / "Limpar", fecha ao clicar fora ou ESC |
| Data início | Date picker | Padrão: 1º do mês atual |
| Data fim | Date picker | Padrão: hoje |
| Hora início | Time picker | Padrão: 00:00 |
| Hora fim | Time picker | Padrão: 23:59 |
| Botão Buscar | — | Dispara busca, exibe loading no botão |
| Botão Limpar | — | Reseta filtros e volta ao estado inicial |

Após busca bem-sucedida, exibe cards de resumo:
- Total de posições
- Distância total estimada (km)
- Velocidade máxima (km/h)
- Tempo em movimento (horas)

### Comportamento do Mapa

| Momento | Comportamento |
|---|---|
| Página carrega | Chama `/api/vehicles` → plota todos os veículos com marcador colorido |
| Clica num marcador | Tooltip com placa, velocidade, última posição; preenche placa no dropdown automaticamente |
| Clica em Buscar | Chama `/api/history` → desenha rota de cada veículo com cor única; zoom automático para enquadrar todas as rotas |
| Veículos não selecionados | Ficam com opacidade reduzida (dimmed) durante visualização de histórico |
| Clica em Limpar | Remove rotas, restaura todos os marcadores ao estado inicial |

### Cores dos veículos
Paleta de 10 cores distintas atribuída automaticamente por ordem de seleção. A mesma cor é usada no marcador, na rota no mapa e na tag do dropdown.

```js
const PALETTE = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a78bfa',
                 '#06b6d4','#f97316','#ec4899','#84cc16','#14b8a6'];
```

### Legenda dinâmica
Exibida no canto inferior esquerdo do mapa após busca. Mostra placa → cor para cada veículo selecionado.

---

## Integração SSX — Detalhes Técnicos

### Endpoint de posições
`POST /v3/Tracking/PositionHistory/List`  
Retorna: `Plate`, `Latitude`, `Longitude`, `PositionDate`, `Speed`, `Course`, `Odometer`

### Filtro de data via QueryCondition
```json
[
  { "PropertyName": "TrackedUnitIntegrationCode", "Condition": "Equal", "Value": "COD_VEICULO" },
  { "PropertyName": "PositionDate", "Condition": "GreaterThanOrEqualTo", "Value": "2026-01-01T00:00:00" },
  { "PropertyName": "PositionDate", "Condition": "LessThan", "Value": "2026-01-01T06:00:00" }
]
```

### Estratégia de paginação (loop 6h)
```
Para cada janela de 6h no período solicitado:
  1. Faz chamada com PositionDate >= início_janela AND < fim_janela
  2. Acumula resultados
  3. Avança 6h
Retorna array completo ao frontend
```

---

## Tratamento de Erros

| Situação | Comportamento |
|---|---|
| Token expirado (401) | Renova token automaticamente, repete chamada |
| Rate limit (429) | Aguarda 2s e tenta novamente (até 3 tentativas) |
| Veículo sem posições no período | Retorna array vazio, exibe aviso no mapa |
| SSX indisponível | Exibe mensagem de erro amigável no frontend |
| `.env` ausente | Servidor não inicia, loga instrução de configuração |

---

## Fora de Escopo (v1)

- Autenticação de usuários no sistema
- Exportação de dados (CSV/Excel)
- Alertas ou notificações
- Rastreamento em tempo real (apenas histórico)
- Múltiplas janelas/abas de período simultâneas
